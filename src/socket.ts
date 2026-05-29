import { io, Socket } from 'socket.io-client';
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { CodeSyncProvider } from './provider';
import { StudentDataProvider } from './treeView';
import { previews } from './extension';
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
  private mainStatusBarItem: vscode.StatusBarItem; // 🔥 Inyección atómica directa para control de UI
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

  // =================================================================
  // 🛰️ CAPA 1: RED, AUTENTICACIÓN Y SEGURIDAD CRIPTOGRÁFICA
  // =================================================================
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

        // 🔥 FIJACIÓN DE NOMBRE EN STATUS BAR: Control directo e inmune a Webpack
        this.mainStatusBarItem.text = `$(account) Estudiante: ${payload?.name || this.currentUserName} | Sala: ${payload?.roomId || 'SALA'}`;
        this.mainStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
        this.mainStatusBarItem.show();

        if (typeof ext.startWpmTracker === 'function') ext.startWpmTracker();
        if (typeof ext.refreshAndSendTree === 'function') ext.refreshAndSendTree();

        vscode.window.showInformationMessage(`✅ CodeSync: Conectado con éxito a la sala.`);

        if (payload?.name && payload?.roomId) {
          this.currentUserName = payload.name;
          this.currentRoomId = payload.roomId;

          // 🔥 PARCHE DE FOCO DIRECTO: Fuerza la apertura instantánea del contenedor de CodeSync Classroom
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

  // =================================================================
  // 📸 CAPA 2: TELEMETRÍA AVANZADA Y PERMISOS DE HARDWARE
  // =================================================================
  private setupTelemetryAndHardwareListeners() {
    this.socket.on('screenshot-received', (data: { studentName: string; image: ArrayBuffer }) => {
      if (CodeSyncDashboard.currentPanel) {
        const rawBinaryArray = new Uint8Array(data.image);
        CodeSyncDashboard.currentPanel['_panel'].webview.postMessage({
          command: 'screenshot-received',
          studentName: data.studentName,
          imageArray: rawBinaryArray,
        });
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

  // =================================================================
  // 💻 CAPA 3: TRANSMISIÓN Y TRÁFICO EN TIEMPO REAL DE CÓDIGO
  // =================================================================
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

  // =================================================================
  // ⏳ CAPA 4: CANALES DE SOPORTE, CHAT Y GESTIÓN DE EXÁMENES
  // =================================================================
  private setupClassroomControlListeners() {
    this.socket.on('chat-message-received', (data: ChatPayload) => {
      this.playSound('start.mp3');

      const esMensajeDuplicado = this.chatHistoryBuffer.some(
        (m) => m.timestamp === data.timestamp && m.senderId === data.senderId && m.message === data.message,
      );

      if (!esMensajeDuplicado) {
        this.chatHistoryBuffer.push(data);
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
    });

    this.socket.on('student-help-resolved', (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, false);
    });

    this.socket.on('request-sync', () => vscode.commands.executeCommand('code-sync.internalRefreshTree'));

    this.socket.on('timer-started', (data: { minutes: number }) => {
      this.playSound('start.mp3');
      this.startCountdown(data.minutes);
    });

    this.socket.on('timer-stopped', () => {
      this.playSound('stop.mp3');
      this.stopCountdown('⚠️ Conteo regresivo cancelado por el docente.');
    });

    this.socket.on(
      'final-submission-received',
      async (data: {
        name: string;
        files: { path: string; content: string }[];
        plagiarismHistory?: { file: string; timestamp: string; wpm: number }[];
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

              if (data.plagiarismHistory && data.plagiarismHistory.length > 0) {
                const reportFileUri = vscode.Uri.joinPath(rootDeliveriesUri, 'REPORTES_PLAGIO.md');

                let reportContent = '';
                try {
                  const existingRaw = await vscode.workspace.fs.readFile(reportFileUri);
                  reportContent = Buffer.from(existingRaw).toString('utf8');
                } catch (e) {
                  reportContent = `# 🚨 CodeSync: Reporte de Auditoría de Plagio\n`;
                  reportContent += `> Generado automáticamente al finalizar el temporizador de evaluación.\n\n`;
                  reportContent += `| Estudiante | Fecha y Hora | Archivo / Ejercicio | Velocidad Detectada |\n`;
                  reportContent += `| :--- | :--- | :--- | :--- |\n`;
                }

                data.plagiarismHistory.forEach((infraccion) => {
                  reportContent += `| **${data.name}** | \`${infraccion.timestamp}\` | \`${infraccion.file}\` | ⚠️ **${infraccion.wpm} WPM** (Copy-Paste) |\n`;
                });

                await vscode.workspace.fs.writeFile(reportFileUri, Buffer.from(reportContent, 'utf8'));
                console.log(`[CodeSync Auditoría]: Bitácora de plagio actualizada para ${data.name}`);
              }
            } catch (e) {
              vscode.window.showErrorMessage(`Error fatal al escribir snapshot de ${data.name}`);
            }
          },
        );
      },
    );
  }

  // =================================================================
  // ♻️ CAPA 5: RESILIENCIA, RECUPERACIÓN REACTIVA E INMORTALIDAD 🛡️
  // =================================================================
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

  // =================================================================
  // ⚙️ MÉTODOS AUXILIARES DE CONTROL Y ORQUESTACIÓN INTERNA
  // =================================================================
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
