import { io, Socket } from 'socket.io-client';
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { CodeSyncProvider } from './provider';
import { StudentDataProvider } from './treeView';
import { previews, startFocusTracking, stopFocusTracking } from './extension';
import { CodeSyncChatPanel } from './chatPanel';
import { CodeSyncDashboard } from './dashboardPanel';

interface UserJoinedPayload {
  id: string;
  name: string;
  role: string;
}

interface TelemetryPayload {
  studentId: string;
  name: string;
  wpm?: number;
  isCopyPaste?: boolean;
  isFocused?: boolean;
  activeFilePath?: string;
}

interface DisconnectPayload {
  socketId: string;
  studentName?: string;
  role?: string;
}

interface ChatPayload {
  senderId: string;
  sender: string;
  role: string;
  message: string;
  targetId?: string;
  isPrivate: boolean;
  timestamp: string;
}

interface FileTreePayload {
  studentId: string;
  name: string;
  files: string[];
}

interface FileUpdatePayload {
  studentId: string;
  filePath: string;
  content: string;
}

/**
 * Gestor de comunicación de alto rendimiento vía WebSockets para CodeSync.
 * Administra de forma asíncrona la telemetría del aula, chat táctico, sincronización y auditoría en tiempo real.
 */
export class SocketManager {
  private socket: Socket;
  private provider?: CodeSyncProvider;
  private treeProvider?: StudentDataProvider;

  private timerInterval?: NodeJS.Timeout;
  private timerStatusBar: vscode.StatusBarItem;
  private mainStatusBarItem: vscode.StatusBarItem;
  private isUrgent: boolean = false;
  private context: vscode.ExtensionContext;

  private role: string = '';
  private currentRoomId: string = '';
  private currentUserName: string = '';
  private roomTargetEndTimestamp: number = 0;
  private readonly activeStudentsList: { id: string; name: string }[] = [];
  private readonly chatHistoryBuffer: ChatPayload[] = [];

  // Recibe la barra de estado por el constructor para evadir el bug de ámbitos circulares
  constructor(serverUrl: string, context: vscode.ExtensionContext, mainStatusBar: vscode.StatusBarItem) {
    this.context = context;
    this.mainStatusBarItem = mainStatusBar;

    this.socket = io(`${serverUrl}/code-sync`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 3000,
    });

    this.timerStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    this.setupListeners();
  }

  public setProviders(provider: CodeSyncProvider, treeProvider: StudentDataProvider) {
    this.provider = provider;
    this.treeProvider = treeProvider;
  }

  public getSocketId(): string {
    return this.socket.id || '';
  }

  public getActiveStudents() {
    return this.activeStudentsList;
  }

  public getCurrentUserName(): string {
    return this.currentUserName;
  }
  public getCurrentRoomId(): string {
    return this.currentRoomId;
  }
  public getUserRole(): string {
    return this.role;
  }

  private playSound(fileName: 'start.mp3' | 'stop.mp3') {
    const soundPath = path.join(this.context.extensionPath, 'assets', fileName);
    const winCommand = `powershell -c "Add-Type -AssemblyName PresentationCore; $mediaPlayer = New-Object System.Windows.Media.MediaPlayer; $mediaPlayer.Open('${soundPath}'); $mediaPlayer.Play(); Start-Sleep -s 3"`;

    const command =
      process.platform === 'win32'
        ? winCommand
        : process.platform === 'darwin'
          ? `afplay "${soundPath}"`
          : `paplay "${soundPath}" || aplay "${soundPath}"`;

    exec(command, (error) => {
      if (error) console.error(`[CodeSync Audio Error]:`, error);
    });
  }

  private setupListeners() {
    this.setupNetworkAndSecurityListeners();
    this.setupTelemetryAndHardwareListeners();
    this.setupCodeReplicationListeners();
    this.setupClassroomControlListeners();
    this.setupResilienceAndRecoveryListeners();
  }

  // Network and Security Listeners
  private setupNetworkAndSecurityListeners() {
    this.socket.on('connect', () => {
      console.log(`[CodeSync]: Canal de red establecido. ID: ${this.getSocketId()}`);

      if (this.currentRoomId && this.currentUserName && this.role) {
        console.log(`[CodeSync Resiliencia]: Re-negociando credenciales en Sala: ${this.currentRoomId}...`);
        this.joinRoom(this.currentRoomId, this.currentUserName, this.role);
      }
    });

    this.socket.on('connect_error', (err) => {
      console.error('[CodeSync]: Error crítico de red ->', err.message);
    });

    this.socket.on('join-success', (payload?: { role?: string; name?: string; roomId?: string }) => {
      const ext = require('./extension');

      vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', true);

      if (this.role === 'teacher') {
        vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', true);
        vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);

        // Modificación de la barra de estado a través del puntero inyectado sin dependencias circulares
        this.mainStatusBarItem.text = `$(shield) Profesor: ${payload?.roomId || 'SALA_ACTIVA'}`;
        this.mainStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.mainStatusBarItem.show();

        console.log('[CodeSync Sockets]: Autenticado como docente. Forzando sincronización de cuadrícula...');
        this.emit('request-dashboard-sync', {});
        vscode.window.showInformationMessage(`🔑 CodeSync: Autenticado con éxito como Docente.`);
        vscode.commands.executeCommand('workbench.view.extension.codesync-explorer');
      } else {
        vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', false);
        vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', true);

        this.mainStatusBarItem.text = `$(account) Estudiante: ${payload?.name || this.currentUserName} | Sala: ${payload?.roomId || 'SALA'}`;
        this.mainStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
        this.mainStatusBarItem.show();

        if (typeof ext.startWpmTracker === 'function') ext.startWpmTracker();
        if (typeof ext.refreshAndSendTree === 'function') ext.refreshAndSendTree();

        vscode.window.showInformationMessage(`✅ CodeSync: Conectado con éxito a la sala.`);

        if (payload?.name && payload?.roomId) {
          this.currentUserName = payload.name;
          this.currentRoomId = payload.roomId;

          vscode.commands.executeCommand('workbench.view.extension.codesync-explorer');
        }
      }
    });

    this.socket.on('join-rejected', (reason: string) => {
      console.error(`[CodeSync Seguridad]: Conexión rebotada por el backend. Motivo: ${reason}`);

      vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);

      this.mainStatusBarItem.text = '$(broadcast) CodeSync: Conectar';
      this.mainStatusBarItem.backgroundColor = undefined;
      this.mainStatusBarItem.show();

      this.currentRoomId = '';
      this.currentUserName = '';
      this.activeStudentsList.length = 0;
      this.treeProvider?.clearAll();
      this.provider?.clearAll();

      vscode.window.showErrorMessage(`🚨 CodeSync Seguridad: Acceso Denegado. ${reason}`);

      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry({ disconnected: true });
      }
    });

    this.socket.on('user-joined', (user: UserJoinedPayload) => {
      if (user.role === 'student' && !this.activeStudentsList.some((s) => s.id === user.id)) {
        this.activeStudentsList.push({ id: user.id, name: user.name });
        this.refreshChatStudentList();
      }
    });

    this.socket.on('user-disconnected', (data: DisconnectPayload) => {
      const id = data.socketId;

      if (!data.role || data.role === 'student') {
        this.treeProvider?.removeStudent(id);
        this.provider?.deleteStudentContent(id);
        const targetIndex = this.activeStudentsList.findIndex((s) => s.id === id);
        if (targetIndex !== -1) this.activeStudentsList.splice(targetIndex, 1);
        this.refreshChatStudentList();
      }

      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry({
          studentId: id,
          studentName: data.studentName,
          role: data.role,
          socketId: id,
          disconnected: true,
        });
      }
    });
  }

  // Telemetry and Hardware Listeners
  private setupTelemetryAndHardwareListeners() {
    this.socket.on('screenshot-received', async (data: { studentName: string; image: ArrayBuffer; isAutomated?: boolean }) => {
      const rawBinaryArray = new Uint8Array(data.image);

      if (!data.isAutomated && CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel['_panel'].webview.postMessage({
          command: 'screenshot-received',
          studentName: data.studentName,
          imageArray: rawBinaryArray,
        });
      }

      if (this.role === 'teacher') {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (workspace) {
          try {
            const rootDeliveriesUri = vscode.Uri.joinPath(workspace.uri, 'ENTREGAS_CODESYNC');
            const folderName = `ENTREGA_${data.studentName.replace(/\s+/g, '_')}`;
            const capturasFolder = vscode.Uri.joinPath(rootDeliveriesUri, folderName, 'Capturas');

            await vscode.workspace.fs.createDirectory(capturasFolder);
            const timestamp = new Date().toLocaleTimeString('es-CO', { hour12: false }).replace(/:/g, '-');
            const fileUri = vscode.Uri.joinPath(capturasFolder, `captura_${timestamp}.jpg`);
            await vscode.workspace.fs.writeFile(fileUri, rawBinaryArray);
          } catch (e) {
            console.error('[CodeSync Error] Guardando captura automática:', e);
          }
        }
      }
    });

    this.socket.on('telemetry-updated', (data: TelemetryPayload) => {
      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry(data);
      }

      if (data.isCopyPaste !== undefined) {
        this.treeProvider?.setPlagiarismStatus(data.studentId, data.isCopyPaste);
      }
    });
  }

  // Real-time Code Replication Listeners
  private setupCodeReplicationListeners() {
    this.socket.on('student-file-tree', (data: FileTreePayload) => {
      console.log(`[CodeSync Replicación]: Estructura de archivos recibida para ${data.name}`);

      if (!this.activeStudentsList.some((s) => s.id === data.studentId)) {
        this.activeStudentsList.push({ id: data.studentId, name: data.name });
        this.treeProvider?.refresh(data.studentId, data.name, []);
        this.refreshChatStudentList();
      }

      this.treeProvider?.refresh(data.studentId, data.name, data.files);
    });

    this.socket.on('code-remote-update', (data: FileUpdatePayload) => this.updateVirtualDocument(data));
    this.socket.on('file-content-received', (data: FileUpdatePayload) => this.updateVirtualDocument(data));

    this.socket.on('force-sync-code', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === 'file') {
        this.emit('code-update', {
          roomId: this.currentRoomId,
          filePath: vscode.workspace.asRelativePath(editor.document.uri),
          content: editor.document.getText(),
        });
      }
    });

    this.socket.on('get-content', async (data: { teacherId: string; filePath: string }) => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) return;
      try {
        const uri = vscode.Uri.joinPath(workspace.uri, data.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        this.emit('send-content', {
          teacherId: data.teacherId,
          filePath: data.filePath,
          content: doc.getText(),
        });
      } catch (e) {
        console.error('[CodeSync P2P]: Error en la lectura del búfer solicitado.');
      }
    });

    this.socket.on('create-local-file', async (data: { fileName: string; initialContent: string }) => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) return;

      const fileUri = vscode.Uri.joinPath(workspace.uri, data.fileName);
      try {
        // Verificar si el archivo ya existe
        try {
          await vscode.workspace.fs.stat(fileUri);

          // Si no lanza error, el archivo existe. Preguntamos al estudiante.
          const confirm = await vscode.window.showWarningMessage(
            `El archivo '${data.fileName}' ya existe en tu entorno. ¿Deseas sobreescribirlo y perder tus avances actuales?`,
            { modal: true },
            'Sí, Sobreescribir'
          );

          if (confirm !== 'Sí, Sobreescribir') {
            vscode.window.showInformationMessage(`Se canceló la inyección del archivo '${data.fileName}'.`);
            return; // Abortar escritura
          }
        } catch (err) {
          // Si fs.stat lanza error, significa que el archivo NO existe. Continuamos.
        }

        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(data.initialContent, 'base64'));
        if (!/\.(jpg|jpeg|png|gif|ico|svg)$/i.test(data.fileName)) {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Error de escritura en el archivo inyectado.`);
      }
    });
  }

  // Classroom Control and Chat Listeners
  private setupClassroomControlListeners() {
    this.socket.on('chat-message-received', (data: ChatPayload) => {
      this.playSound('start.mp3');

      const esMensajeDuplicado = this.chatHistoryBuffer.some(
        (m) => m.timestamp === data.timestamp && m.senderId === data.senderId && m.message === data.message,
      );

      if (!esMensajeDuplicado) {
        this.chatHistoryBuffer.push(data);
        if (this.chatHistoryBuffer.length > 100) this.chatHistoryBuffer.shift();
      }

      if (CodeSyncChatPanel.currentPanel) {
        CodeSyncChatPanel.currentPanel.addMessage(data, this.getSocketId());
      } else {
        vscode.window.setStatusBarMessage(`💬 Chat: Mensaje nuevo de ${data.sender}`, 5000);
      }

      if (!data.isPrivate && data.role === 'teacher' && this.role === 'student') {
        vscode.window.showInformationMessage(`📢 Comunicado del Profe: "${data.message}"`);
      }
    });

    this.socket.on('student-help-requested', (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, true);
      vscode.window.showInformationMessage(`🙋‍♂️ Un estudiante solicita ayuda presencial.`);
      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry({ studentId: data.studentId, isAskingHelp: true });
      }
    });

    this.socket.on('student-help-resolved', (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, false);
      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry({ studentId: data.studentId, isAskingHelp: false });
      }
    });

    this.socket.on('kicked-by-teacher', async () => {
      await vscode.window.showErrorMessage('Has sido expulsado de la sala por el profesor.', { modal: true });
      this.socket.disconnect();
      vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);
      this.treeProvider?.clearAll();
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

    this.socket.on('force-reload-extension', async () => {
      await vscode.window.showWarningMessage('⚠️ Has iniciado sesión desde otra ubicación o cambiaste de sala. Esta sesión será cerrada por seguridad.', { modal: true });
      this.socket.disconnect();
      vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);
      this.treeProvider?.clearAll();
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    });

    this.socket.on('request-sync', () => vscode.commands.executeCommand('code-sync.internalRefreshTree'));

    this.socket.on('timer-started', (data: { minutes: number }) => {
      this.playSound('start.mp3');
      if (this.role === 'student') startFocusTracking();
      this.startCountdown(data.minutes);
    });

    this.socket.on('timer-stopped', () => {
      this.playSound('stop.mp3');
      if (this.role === 'student') stopFocusTracking();
      this.stopCountdown('⚠️ Conteo regresivo cancelado por el docente.');
    });

    this.socket.on(
      'final-submission-received',
      async (data: {
        name: string;
        files: { path: string; content: string }[];
        plagiarismHistory?: { file: string; timestamp: string; wpm: number }[];
        focusStats?: { activeMs: number; inactiveMs: number };
      }) => {
        if (this.role !== 'teacher') return;

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;

        const rootDeliveriesUri = vscode.Uri.joinPath(workspace.uri, 'ENTREGAS_CODESYNC');
        const folderName = `ENTREGA_${data.name.replace(/\s+/g, '_')}`;
        const studentFolderUri = vscode.Uri.joinPath(rootDeliveriesUri, folderName);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `📥 Descargando entrega de ${data.name}...`,
            cancellable: false,
          },
          async () => {
            try {
              for (const file of data.files) {
                const fileUri = vscode.Uri.joinPath(studentFolderUri, file.path);
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'base64'));
              }
              vscode.window.showInformationMessage(`✅ Entrega de ${data.name} guardada en disco.`);

              // Generar Reporte de Auditoría Individual
              const reportFileUri = vscode.Uri.joinPath(studentFolderUri, 'REPORTE_AUDITORIA.md');
              let reportContent = `# 🚨 CodeSync: Reporte de Auditoría\n`;
              reportContent += `> Estudiante: **${data.name}**\n`;
              reportContent += `> Generado automáticamente al finalizar el temporizador.\n\n`;

              // Reporte de Foco
              reportContent += `## ⏱️ Telemetría de Foco en VS Code\n`;
              if (data.focusStats) {
                const actMins = Math.floor(data.focusStats.activeMs / 60000);
                const actSecs = Math.floor((data.focusStats.activeMs % 60000) / 1000);
                const inactMins = Math.floor(data.focusStats.inactiveMs / 60000);
                const inactSecs = Math.floor((data.focusStats.inactiveMs % 60000) / 1000);
                reportContent += `- **Tiempo Activo (Focus):** ${actMins}m ${actSecs}s\n`;
                reportContent += `- **Tiempo Inactivo (Background):** ${inactMins}m ${inactSecs}s\n\n`;
              } else {
                reportContent += `_Sin datos de foco disponibles._\n\n`;
              }

              // Reporte de Capturas Automáticas
              reportContent += `## 📸 Monitoreo de Hardware\n`;
              reportContent += `- Las capturas de pantalla tomadas durante el periodo de prueba se encuentran adjuntas en el directorio \`/Capturas\` de esta misma entrega.\n\n`;

              // Reporte de Plagio
              reportContent += `## ⚠️ Historial de Plagio (Copy-Paste)\n`;
              if (data.plagiarismHistory && data.plagiarismHistory.length > 0) {
                reportContent += `| Fecha y Hora | Archivo / Ejercicio | Velocidad Detectada |\n`;
                reportContent += `| :--- | :--- | :--- |\n`;
                data.plagiarismHistory.forEach((infraccion) => {
                  reportContent += `| \`${infraccion.timestamp}\` | \`${infraccion.file}\` | **${infraccion.wpm} WPM** |\n`;
                });
              } else {
                reportContent += `_No se detectaron comportamientos anómalos de escritura._\n`;
              }

              await vscode.workspace.fs.writeFile(reportFileUri, Buffer.from(reportContent, 'utf8'));
              console.log(`[CodeSync Auditoría]: Reporte individual creado para ${data.name}`);

            } catch (e) {
              vscode.window.showErrorMessage(`Error fatal al escribir snapshot de ${data.name}`);
            }
          },
        );
      },
    );
  }

  // Resilience and Recovery Listeners
  private setupResilienceAndRecoveryListeners() {
    this.socket.on('timer-registered-on-teacher', (data: { targetEndTimestamp: number }) => {
      this.roomTargetEndTimestamp = data.targetEndTimestamp;
      console.log(
        `[CodeSync Resiliencia]: Sello de tiempo guardado localmente: ${new Date(this.roomTargetEndTimestamp).toLocaleTimeString()}`,
      );
    });

    this.socket.on('request-teacher-state-recovery', (data: { roomId: string }) => {
      if (this.role === 'teacher' && this.roomTargetEndTimestamp > Date.now()) {
        console.log('[CodeSync Resiliencia]: Servidor reiniciado detectado. Inyectando respaldo de sala...');
        this.socket.emit('recover-timer-state', {
          roomId: data.roomId,
          targetEndTimestamp: this.roomTargetEndTimestamp,
        });
      }
    });

    this.socket.on('request-student-refresh', (data: { studentId: string; name: string }) => {
      if (this.role === 'teacher') {
        console.log(`[CodeSync Resiliencia]: Sincronizando nuevo estado para alumno reconectado: ${data.name}`);
        if (!this.activeStudentsList.some((s) => s.id === data.studentId)) {
          this.activeStudentsList.push({ id: data.studentId, name: data.name });
          this.refreshChatStudentList();
        }
      }
    });
  }

  // Helper Methods
  private startCountdown(minutes: number) {
    this.stopCountdown();
    let timeLeft = Math.floor(minutes * 60);
    this.timerStatusBar.show();

    this.timerInterval = setInterval(async () => {
      timeLeft--;
      if (timeLeft < 0) timeLeft = 0;

      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      const timeString = `${mins}:${secs.toString().padStart(2, '0')}`;

      this.isUrgent = timeLeft <= 30;
      this.timerStatusBar.text = `$(watch) TIEMPO: ${timeString}`;

      if (this.isUrgent) {
        this.timerStatusBar.color = '#ff0080';
        this.timerStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.timerStatusBar.text = `$(warning) ¡ENTREGA: ${timeString}!`;
      } else {
        this.timerStatusBar.color = '#00ffcc';
        this.timerStatusBar.backgroundColor = undefined;
      }

      if (timeLeft <= 0) {
        this.stopCountdown();
        this.playSound('stop.mp3');
        this.roomTargetEndTimestamp = 0;
        await vscode.commands.executeCommand('code-sync.sendFullProjectSnapshot');
        vscode.window.showWarningMessage('⏳ ¡TIEMPO AGOTADO! Recolección automática ejecutada.');
      }
    }, 1000);
  }

  private stopCountdown(msg?: string) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerStatusBar.hide();
    if (msg) vscode.window.showInformationMessage(msg);
  }

  private updateVirtualDocument(data: { studentId: string; filePath: string; content: string }) {
    if (!this.provider) return;
    const uri = CodeSyncProvider.createUri(data.studentId, data.filePath);
    this.provider.updateContent(uri, data.content);

    if (data.filePath.toLowerCase().endsWith('.html')) {
      const panel = previews.get(uri.toString());
      if (panel) panel.webview.html = data.content;
    }
  }

  private refreshChatStudentList() {
    if (CodeSyncChatPanel.currentPanel) {
      CodeSyncChatPanel.currentPanel.updateStudentList(this.activeStudentsList);
    }
  }

  public joinRoom(roomId: string, name: string, role: string) {
    this.role = role;
    this.currentRoomId = roomId;
    this.currentUserName = name;

    const config = vscode.workspace.getConfiguration('codeSync');
    const accessKey = config.get<string>('teacherKey') || '';

    if (role === 'teacher' && !accessKey) {
      vscode.window.showErrorMessage('Error: Clave de acceso de docente no configurada en los ajustes.');
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }, 1000);
      return;
    }

    this.socket.emit('join-room', { roomId, name, role, accessKey });
  }

  public emit(event: string, data: any) {
    if (this.socket.connected) this.socket.emit(event, data);
  }

  public emitChat(message: string, targetId?: string) {
    if (this.socket.connected) {
      this.socket.emit('send-chat-message', { message, targetId });
    }
  }

  public getChatHistory(): ChatPayload[] {
    return this.chatHistoryBuffer;
  }
}
