import { io, Socket } from "socket.io-client";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider } from "./treeView";
import { previews } from "./extension";
import { CodeSyncChatPanel } from "./chatPanel";

/**
 * Gestor de comunicación vía WebSockets para CodeSync.
 * Versión optimizada para Status Bar (Sin HUD flotante).
 */
export class SocketManager {
  private socket: Socket;
  private provider?: CodeSyncProvider;
  private treeProvider?: StudentDataProvider;

  // Propiedades para el Desafío (Timer)
  private timerInterval?: NodeJS.Timeout;
  private timerStatusBar: vscode.StatusBarItem;
  private isUrgent: boolean = false;
  private context: vscode.ExtensionContext;

  constructor(serverUrl: string, context: vscode.ExtensionContext) {
    this.context = context;
    // Configuración con reconexión automática para el laboratorio
    this.socket = io(`${serverUrl}/code-sync`, {
      transports: ["websocket"],
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    });

    // Creamos la barra de estado a la IZQUIERDA.
    // Prioridad 101 para que aparezca justo al lado (o antes) del botón Conectar.
    this.timerStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      101,
    );

    this.setupListeners();
  }

  public setProviders(
    provider: CodeSyncProvider,
    treeProvider: StudentDataProvider,
  ) {
    this.provider = provider;
    this.treeProvider = treeProvider;
  }

  /**
   * Helper para reproducir sonidos según el SO.
   */
  private playSound(fileName: "start.mp3" | "stop.mp3") {
    const soundPath = path.join(this.context.extensionPath, "assets", fileName);
    const winCommand = `powershell -c "Add-Type -AssemblyName PresentationCore; $mediaPlayer = New-Object System.Windows.Media.MediaPlayer; $mediaPlayer.Open('${soundPath}'); $mediaPlayer.Play(); Start-Sleep -s 3"`;
    const command =
      process.platform === "win32"
        ? winCommand
        : process.platform === "darwin"
          ? `afplay "${soundPath}"`
          : `paplay "${soundPath}" || aplay "${soundPath}"`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[CodeSync Audio Error]:`, error);
      }
    });
  }

  private setupListeners() {
    this.socket.on("connect", () => {
      console.log(`[CodeSync]: Conexión establecida. ID: ${this.socket.id}`);
      vscode.window.showInformationMessage("🚀 CodeSync: Online");
    });

    this.socket.on("connect_error", (err) =>
      console.error("[CodeSync]: Error de conexión ->", err.message),
    );

    // --- SECCIÓN: DOCENTE (Monitorización y Entregas) ---

    // 1. Recibir árbol de archivos del estudiante
    this.socket.on(
      "student-file-tree",
      (data: { studentId: string; name: string; files: string[] }) => {
        this.treeProvider?.refresh(data.studentId, data.name, data.files);
      },
    );

    // 2. Limpieza al desconectar
    this.socket.on("user-disconnected", (id: string) => {
      this.treeProvider?.removeStudent(id);
      this.provider?.deleteStudentContent(id);
    });

    // 3. RECIBIR SNAPSHOT FINAL (Guardado automático)
    this.socket.on(
      "final-submission-received",
      async (data: {
        name: string;
        files: { path: string; content: string }[];
      }) => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;

        const folderName = `ENTREGA_${data.name.replace(/\s+/g, "_")}`;
        const rootUri = vscode.Uri.joinPath(
          workspace.uri,
          "ENTREGAS_CODESYNC",
          folderName,
        );

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
                const contentBuffer = Buffer.from(file.content, "base64");
                await vscode.workspace.fs.writeFile(fileUri, contentBuffer);
              }
              vscode.window.showInformationMessage(
                `✅ Entrega de ${data.name} guardada correctamente.`,
              );
            } catch (e) {
              vscode.window.showErrorMessage(
                `Error al guardar entrega de ${data.name}`,
              );
            }
          },
        );
      },
    );

    // --- SECCIÓN: ESTUDIANTE (Acciones Remotas) ---

    this.socket.on("request-sync", () =>
      vscode.commands.executeCommand("code-sync.internalRefreshTree"),
    );

    // Recibir archivos del profesor
    this.socket.on(
      "create-local-file",
      async (data: { fileName: string; initialContent: string }) => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;

        const fileUri = vscode.Uri.joinPath(workspace.uri, data.fileName);
        try {
          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from(data.initialContent, "base64"),
          );
          if (!/\.(jpg|jpeg|png|gif|ico|svg)$/i.test(data.fileName)) {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
          }
        } catch (e) {
          vscode.window.showErrorMessage(
            `Error al crear archivo enviado por el profesor.`,
          );
        }
      },
    );

    this.socket.on("student-help-requested", (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, true);
      // Opcional: Notificación sonora o visual para el profe
      vscode.window.showInformationMessage(`🙋‍♂️ Un estudiante solicita ayuda.`);
    });

    this.socket.on("student-help-resolved", (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, false);
    });

    this.socket.on("chat-message-received", (data: any) => {
      // 1. Reproducir sonido de notificación (Opcional, reutilizando tu playSound)
      // this.playSound("start.mp3");

      // 2. Si el panel está abierto, inyectar el mensaje
      if (CodeSyncChatPanel.currentPanel) {
        CodeSyncChatPanel.currentPanel.addMessage(data);
      } else {
        // Si está cerrado, avisar sutilmente
        vscode.window.showInformationMessage(
          `💬 Nuevo mensaje de ${data.sender}`,
        );
      }
    });

    // Responder con contenido (Petición P2P)
    this.socket.on(
      "get-content",
      async (data: { teacherId: string; filePath: string }) => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;
        try {
          const uri = vscode.Uri.joinPath(workspace.uri, data.filePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          this.socket.emit("send-content", {
            teacherId: data.teacherId,
            filePath: data.filePath,
            content: doc.getText(),
          });
        } catch (e) {
          console.error("No se pudo obtener el contenido solicitado.");
        }
      },
    );

    // --- SECCIÓN: DESAFÍO (TIMER) ---
    this.socket.on("timer-started", (data: { minutes: number }) => {
      this.playSound("start.mp3");
      this.startCountdown(data.minutes);
    });

    this.socket.on("timer-stopped", () => {
      this.playSound("stop.mp3");
      this.stopCountdown("⚠️ Desafío cancelado.");
    });

    // --- LIVE SYNC ---
    this.socket.on("code-remote-update", (data: any) =>
      this.updateVirtualDocument(data),
    );
    this.socket.on("file-content-received", (data: any) =>
      this.updateVirtualDocument(data),
    );
  }

  /**
   * Lógica del Cronómetro.
   * Ahora soporta sincronización exacta tras reconexión.
   */
  private startCountdown(minutes: number) {
    this.stopCountdown();

    // Convertimos a segundos totales para manejar decimales que vienen del server
    let timeLeft = Math.floor(minutes * 60);

    this.timerStatusBar.show();

    this.timerInterval = setInterval(async () => {
      timeLeft--;

      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      const timeString = `${mins}:${secs.toString().padStart(2, "0")}`;

      this.isUrgent = timeLeft <= 30;

      this.timerStatusBar.text = `$(watch) TIEMPO: ${timeString}`;

      if (this.isUrgent) {
        this.timerStatusBar.color = "#ff0080";
        this.timerStatusBar.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        );
        this.timerStatusBar.text = `$(warning) ¡ENTREGA: ${timeString}!`;
      } else {
        this.timerStatusBar.color = "#00ffcc";
        this.timerStatusBar.backgroundColor = undefined;
      }

      if (timeLeft <= 0) {
        this.stopCountdown();
        this.playSound("stop.mp3");
        // Solo los estudiantes envían snapshot (ya está validado en el comando)
        await vscode.commands.executeCommand(
          "code-sync.sendFullProjectSnapshot",
        );
        vscode.window.showWarningMessage(
          "⏳ ¡TIEMPO AGOTADO! Entrega automática realizada.",
        );
      }
    }, 1000);
  }

  private stopCountdown(msg?: string) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerStatusBar.hide();
    if (msg) vscode.window.showInformationMessage(msg);
  }

  private updateVirtualDocument(data: {
    studentId: string;
    filePath: string;
    content: string;
  }) {
    if (!this.provider) return;
    const uri = CodeSyncProvider.createUri(data.studentId, data.filePath);
    this.provider.updateContent(uri, data.content);

    if (data.filePath.toLowerCase().endsWith(".html")) {
      const panel = previews.get(uri.toString());
      if (panel) panel.webview.html = data.content;
    }
  }

  public joinRoom(roomId: string, name: string, role: string) {
    this.socket.emit("join-room", { roomId, name, role });
  }

  public emit(event: string, data: any) {
    if (this.socket.connected) this.socket.emit(event, data);
  }

  public emitChat(message: string) {
    this.socket.emit("send-chat-message", { message });
  }
}
