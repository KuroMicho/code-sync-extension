import { io, Socket } from 'socket.io-client';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

  // Propiedades del Cronómetro Técnico de Evaluación
  private timerInterval?: NodeJS.Timeout;
  private timerStatusBar: vscode.StatusBarItem;
  private isUrgent: boolean = false;
  private context: vscode.ExtensionContext;

  // Cache contextual de privilegios y pool de estudiantes legítimos
  private role: string = '';
  private activeStudentsList: { id: string; name: string }[] = [];
  private chatHistoryBuffer: ChatPayload[] = [];

  constructor(serverUrl: string, context: vscode.ExtensionContext) {
    this.context = context;

    // Configuración resiliente a fluctuaciones inalámbricas severas en salas de cómputo
    this.socket = io(`${serverUrl}/code-sync`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 10,
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

  /**
   * Pipeline de ejecución de audio nativo por hilos en background según el Sistema Operativo.
   */
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

  /**
   * Registro centralizado de eventos e interceptores de red.
   */
  private setupListeners() {
    this.setupNetworkAndSecurityListeners();
    this.setupTelemetryAndHardwareListeners();
    this.setupCodeReplicationListeners();
    this.setupClassroomControlListeners();
  }

  // =================================================================
  // 🛰️ CAPA 1: RED, AUTENTICACIÓN Y SEGURIDAD CRIPTOGRÁFICA
  // =================================================================
  private setupNetworkAndSecurityListeners() {
    this.socket.on('connect', () => {
      console.log(`[CodeSync]: Canal de red establecido. ID: ${this.getSocketId()}`);
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

        if (ext.statusBarItem) {
          ext.statusBarItem.text = `$(shield) Profesor: ${payload?.roomId || 'SALA_ACTIVA'}`;
          ext.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }

        console.log('[CodeSync Sockets]: Autenticado como docente. Forzando sincronización de cuadrícula...');
        this.emit('request-dashboard-sync', {});
        vscode.window.showInformationMessage(`🔑 CodeSync: Autenticado con éxito como Docente.`);
      } else {
        vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', false);
        vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', true);

        if (ext.statusBarItem) {
          ext.statusBarItem.text = `$(check) Estudiante: ${payload?.roomId || 'SALA_ACTIVA'}`;
          ext.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
        }

        if (typeof ext.startWpmTracker === 'function') ext.startWpmTracker();
        if (typeof ext.refreshAndSendTree === 'function') ext.refreshAndSendTree();

        vscode.window.showInformationMessage(`✅ CodeSync: Conectado con éxito a la sala.`);

        // 🚀 AUTOMATIZACIÓN SUPREMA: Creamos el pasaporte digital y abrimos el navegador local automáticamente
        if (payload?.name && payload?.roomId) {
          const encodedName = encodeURIComponent(payload.name);
          const encodedRoom = encodeURIComponent(payload.roomId);

          // Sincronizado con el puerto estático local del backend
          const urlDestino = `http://localhost:3000/public/index.html?room=${encodedRoom}&name=${encodedName}`;

          console.log(`[CodeSync UX]: Desplegando panel web dinámico en: ${urlDestino}`);
          vscode.env.openExternal(vscode.Uri.parse(urlDestino));
        }
      }
    });

    this.socket.on('join-rejected', (reason: string) => {
      console.error(`[CodeSync Seguridad]: Conexión rebotada por el backend. Motivo: ${reason}`);
      const ext = require('./extension');

      vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', false);
      vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);

      if (ext.statusBarItem) {
        ext.statusBarItem.text = '$(broadcast) CodeSync: Conectar';
        ext.statusBarItem.backgroundColor = undefined;
        ext.statusBarItem.show();
      }

      this.activeStudentsList = [];
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
        this.activeStudentsList = this.activeStudentsList.filter((s) => s.id !== id);
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
  // ⏳ CAPA 4: CANALES DE SOPORTE, CHAT Y RECONEXIÓN DE EXÁMENES
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
      async (data: { name: string; files: { path: string; content: string }[] }) => {
        if (this.role !== 'teacher') return;

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;

        const folderName = `ENTREGA_${data.name.replace(/\s+/g, '_')}`;
        const rootUri = vscode.Uri.joinPath(workspace.uri, 'ENTREGAS_CODESYNC', folderName);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `📥 Descargando entrega de ${data.name}...`,
            cancellable: false,
          },
          async () => {
            try {
              for (const file of data.files) {
                const fileUri = vscode.Uri.joinPath(rootUri, file.path);
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'base64'));
              }
              vscode.window.showInformationMessage(`✅ Entrega de ${data.name} guardada en disco.`);
            } catch (e) {
              vscode.window.showErrorMessage(`Error fatal al escribir snapshot de ${data.name}`);
            }
          },
        );
      },
    );
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
