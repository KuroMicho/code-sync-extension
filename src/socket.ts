import { io, Socket } from "socket.io-client";
import * as vscode from "vscode";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider } from "./treeView";
import { previews } from "./extension";

export class SocketManager {
  private socket: Socket;
  private provider?: CodeSyncProvider;
  private treeProvider?: StudentDataProvider;
  private timerInterval?: NodeJS.Timeout;
  private timerStatusBar: vscode.StatusBarItem;
  private hudDecoration?: vscode.TextEditorDecorationType;

  constructor(serverUrl: string) {
    this.socket = io(`${serverUrl}/code-sync`, {
      transports: ["websocket"],
      autoConnect: true,
    });
    this.timerStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000,
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

  private setupListeners() {
    this.socket.on("connect", () =>
      console.log("[CodeSync]: Conexión exitosa."),
    );

    // --- DOCENTE: RECIBIR ENTREGAS FINALES ---
    this.socket.on(
      "final-submission-received",
      async (data: {
        name: string;
        files: { path: string; content: string }[];
      }) => {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) return;

        // Crear carpeta: /ENTREGAS_CODESYNC/Alumno_Nombre
        const folderName = `ENTREGA_${data.name.replace(/\s+/g, "_")}`;
        const rootUri = vscode.Uri.joinPath(
          workspace.uri,
          "ENTREGAS_CODESYNC",
          folderName,
        );

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `📥 Guardando entrega de ${data.name}...`,
          },
          async () => {
            for (const file of data.files) {
              const fileUri = vscode.Uri.joinPath(rootUri, file.path);
              await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(file.content, "base64"),
              );
            }
            vscode.window.showInformationMessage(
              `✅ Entrega de ${data.name} lista en /ENTREGAS_CODESYNC`,
            );
          },
        );
      },
    );

    this.socket.on("student-file-tree", (data) =>
      this.treeProvider?.refresh(data.studentId, data.name, data.files),
    );
    this.socket.on("user-disconnected", (id) => {
      this.treeProvider?.removeStudent(id);
      this.provider?.deleteStudentContent(id);
    });

    // --- ESTUDIANTE: RECIBIR ARCHIVOS Y TIMER ---
    this.socket.on("create-local-file", async (data) => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) return;
      const fileUri = vscode.Uri.joinPath(workspace.uri, data.fileName);
      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(data.initialContent, "base64"),
      );

      if (!/\.(jpg|jpeg|png|gif|ico|svg)$/i.test(data.fileName)) {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
      }
    });

    this.socket.on("timer-started", (data: { minutes: number }) =>
      this.startCountdown(data.minutes),
    );
    this.socket.on("timer-stopped", () =>
      this.stopCountdown("Desafío cancelado."),
    );

    this.socket.on("code-remote-update", (data) =>
      this.updateVirtualDocument(data),
    );
    this.socket.on("file-content-received", (data) =>
      this.updateVirtualDocument(data),
    );
  }

  private startCountdown(minutes: number) {
    this.stopCountdown();
    let timeLeft = minutes * 60;
    this.timerStatusBar.show();

    this.timerInterval = setInterval(async () => {
      timeLeft--;
      const timeString = `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, "0")}`;

      // Estética Lo-fi
      this.timerStatusBar.text = `$(watch) RESTAN: ${timeString}`;
      this.timerStatusBar.color = timeLeft <= 30 ? "#ff0080" : "#00ffcc";
      this.updateHUD(timeString, timeLeft <= 30);

      if (timeLeft <= 0) {
        this.stopCountdown();
        // Disparar envío automático de todo el código
        await vscode.commands.executeCommand(
          "code-sync.sendFullProjectSnapshot",
        );
        vscode.window.showWarningMessage(
          "⏳ ¡Tiempo agotado! Tu proyecto ha sido entregado.",
        );
      }
    }, 1000);
  }

  private updateHUD(timeString: string, isUrgent: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (this.hudDecoration) this.hudDecoration.dispose();

    const color = isUrgent ? "#ff0080" : "#00ffcc";
    this.hudDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: ` ⏳ ${timeString} `,
        margin: "0 0 0 3em",
        color,
        fontWeight: "bold",
        border: `1px solid ${color}`,
        backgroundColor: "#1e1e1e",
      },
    });

    const range = new vscode.Range(
      0,
      editor.document.lineAt(0).text.length,
      0,
      editor.document.lineAt(0).text.length,
    );
    editor.setDecorations(this.hudDecoration, [range]);
  }

  private stopCountdown(msg?: string) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.hudDecoration) this.hudDecoration.dispose();
    this.timerStatusBar.hide();
    if (msg) vscode.window.showInformationMessage(msg);
  }

  private updateVirtualDocument(data: any) {
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
}
