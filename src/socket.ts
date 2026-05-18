import { io, Socket } from "socket.io-client";
import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider } from "./treeView";
import { previews } from "./extension";
import { CodeSyncChatPanel } from "./chatPanel";
import { CodeSyncDashboard } from "./dashboardPanel";

/**
 * Gestor de comunicación vía WebSockets para CodeSync.
 * Controla la sincronización de archivos, telemetría en vivo, chat y cronómetro.
 */
export class SocketManager {
  private socket: Socket;
  private provider?: CodeSyncProvider;
  private treeProvider?: StudentDataProvider;

  // Propiedades del Cronómetro Técnico (Timer)
  private timerInterval?: NodeJS.Timeout;
  private timerStatusBar: vscode.StatusBarItem;
  private isUrgent: boolean = false;
  private context: vscode.ExtensionContext;

  // Caché local para control estricto de permisos del cliente
  private role: string = "";

  // Memoria volátil de estudiantes en la sala actual (Alimenta chats y dashboards)
  private activeStudentsList: { id: string; name: string }[] = [];

  constructor(serverUrl: string, context: vscode.ExtensionContext) {
    this.context = context;

    // Configuración con tolerancia a microcortes inalámbricos (Ideal para routers de aula)
    this.socket = io(`${serverUrl}/code-sync`, {
      transports: ["websocket"],
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    });

    // Inicialización del display del temporizador en la barra inferior izquierda
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
   * Retorna el identificador de conexión único del socket.
   */
  public getSocketId(): string {
    return this.socket.id || "";
  }

  /**
   * Retorna los estudiantes mapeados localmente en la sala.
   */
  public getActiveStudents() {
    return this.activeStudentsList;
  }

  /**
   * Pipeline de execution multimedia nativo por sistema operativo.
   * Utiliza hilos en background (PresentationCore) para no congelar el editor.
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

    exec(command, (error) => {
      if (error) {
        console.error(`[CodeSync Audio Error]:`, error);
      }
    });
  }

  private setupListeners() {
    // --- MONITORIZACIÓN DE RED GLOBAL ---
    this.socket.on("connect", () => {
      console.log(`[CodeSync]: Conexión establecida. ID: ${this.socket.id}`);
      vscode.window.showInformationMessage("🚀 CodeSync: En Línea");
    });

    this.socket.on("connect_error", (err) =>
      console.error("[CodeSync]: Error de conexión ->", err.message),
    );

    // --- CONTROL DE FLUJO DE USUARIOS (SALAS) ---
    this.socket.on(
      "user-joined",
      (user: { id: string; name: string; role: string }) => {
        if (user.role === "student") {
          if (!this.activeStudentsList.some((s) => s.id === user.id)) {
            this.activeStudentsList.push({ id: user.id, name: user.name });

            // Sincronización en vivo del dropdown del chat docente
            if (CodeSyncChatPanel.currentPanel) {
              CodeSyncChatPanel.currentPanel.updateStudentList(
                this.activeStudentsList,
              );
            }
          }
        }
      },
    );

    this.socket.on("user-disconnected", (id: string) => {
      // 1. Limpieza de buffers virtuales y árbol jerárquico izquierdo
      this.treeProvider?.removeStudent(id);
      this.provider?.deleteStudentContent(id);

      // 2. Remoción de las colas de mensajería del chat
      this.activeStudentsList = this.activeStudentsList.filter(
        (s) => s.id !== id,
      );
      if (CodeSyncChatPanel.currentPanel) {
        CodeSyncChatPanel.currentPanel.updateStudentList(
          this.activeStudentsList,
        );
      }

      // 3. Purga o actualización visual en el Dashboard del docente
      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry({
          studentId: id,
          disconnected: true,
        });
      }
    });

    // --- SISTEMA DE TELEMETRÍA (DASHBOARD CENTRAL) ---
    this.socket.on("telemetry-updated", (data: any) => {
      if (CodeSyncDashboard.currentPanel) {
        CodeSyncDashboard.currentPanel.updateTelemetry(data);
      }

      // Sincronización cruzada con la barra lateral jerárquica
      if (data.isCopyPaste !== undefined) {
        this.treeProvider?.setPlagiarismStatus(
          data.studentId,
          data.isCopyPaste,
        );
      }
    });

    // --- COMUNICACIÓN POR CHAT (CYBER-ROOM) ---
    this.socket.on("chat-message-received", (data: any) => {
      this.playSound("start.mp3");

      if (CodeSyncChatPanel.currentPanel) {
        CodeSyncChatPanel.currentPanel.addMessage(data, this.getSocketId());
      } else {
        vscode.window.setStatusBarMessage(
          `💬 Chat: Mensaje de ${data.sender}`,
          4000,
        );
      }

      // 📢 Alerta Banner Toast visible si el profesor envía un comunicado general y el chat está cerrado
      if (
        !data.isPrivate &&
        data.role === "teacher" &&
        this.role === "student"
      ) {
        vscode.window.showInformationMessage(
          `📢 Comunicado del Profe: "${data.message}"`,
        );
      }
    });

    // --- TRANSMISIÓN Y REPLICACIÓN DE CÓDIGO ---
    this.socket.on(
      "student-file-tree",
      (data: { studentId: string; name: string; files: string[] }) => {
        this.treeProvider?.refresh(data.studentId, data.name, data.files);

        // Salvaguarda: Mapea al estudiante en la lista si se saltó el evento principal de entrada
        if (!this.activeStudentsList.some((s) => s.id === data.studentId)) {
          this.activeStudentsList.push({ id: data.studentId, name: data.name });
          if (CodeSyncChatPanel.currentPanel) {
            CodeSyncChatPanel.currentPanel.updateStudentList(
              this.activeStudentsList,
            );
          }
        }
      },
    );

    this.socket.on("code-remote-update", (data: any) =>
      this.updateVirtualDocument(data),
    );
    this.socket.on("file-content-received", (data: any) =>
      this.updateVirtualDocument(data),
    );

    // --- GESTIÓN DE ALERTAS (SOPORTE EN VIVO) ---
    this.socket.on("student-help-requested", (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, true);
      vscode.window.showInformationMessage(`🙋‍♂️ Un estudiante solicita ayuda.`);
    });

    this.socket.on("student-help-resolved", (data: { studentId: string }) => {
      this.treeProvider?.setHelpStatus(data.studentId, false);
    });

    // --- ACCIONES REMOTAS E INYECCIÓN P2P ---
    this.socket.on("request-sync", () =>
      vscode.commands.executeCommand("code-sync.internalRefreshTree"),
    );

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
          console.error("Error en la lectura local del búfer P2P solicitado.");
        }
      },
    );

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
            `Error de escritura en el archivo inyectado.`,
          );
        }
      },
    );

    // --- COLA DE ENTREGAS FINALES (DESAFÍOS) ---
    this.socket.on(
      "final-submission-received",
      async (data: {
        name: string;
        files: { path: string; content: string }[];
      }) => {
        // 🛡️ ESCUDO DE SEGURIDAD: Solo el entorno del Profesor procesa y escribe entregas
        if (this.role !== "teacher") return;

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
                `✅ Entrega de ${data.name} persistida en disco.`,
              );
            } catch (e) {
              vscode.window.showErrorMessage(
                `Error fatal al procesar snapshot de ${data.name}`,
              );
            }
          },
        );
      },
    );

    // --- CONTROL SÉPRICO DEL CRONÓMETRO ---
    this.socket.on("timer-started", (data: { minutes: number }) => {
      this.playSound("start.mp3");
      this.startCountdown(data.minutes);
    });

    this.socket.on("timer-stopped", () => {
      this.playSound("stop.mp3");
      this.stopCountdown("⚠️ Desafío cancelado por el docente.");
    });
  }

  /**
   * Ejecuta el hilo del cronómetro regresivo en la barra inferior.
   */
  private startCountdown(minutes: number) {
    this.stopCountdown();
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
        await vscode.commands.executeCommand(
          "code-sync.sendFullProjectSnapshot",
        );
        vscode.window.showWarningMessage(
          "⏳ ¡TIEMPO AGOTADO! Despacho automático ejecutado.",
        );
      }
    }, 1000);
  }

  private stopCountdown(msg?: string) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerStatusBar.hide();
    if (msg) vscode.window.showInformationMessage(msg);
  }

  /**
   * Actualiza el proveedor virtual e inyecta datos en los webviews HTML abiertos.
   */
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
    this.role = role; // Fijamos el rol localmente en el cliente para los validadores contextuales
    this.socket.emit("join-room", { roomId, name, role });
  }

  public emit(event: string, data: any) {
    if (this.socket.connected) this.socket.emit(event, data);
  }

  public emitChat(message: string, targetId?: string) {
    if (this.socket.connected) {
      this.socket.emit("send-chat-message", { message, targetId });
    }
  }
}
