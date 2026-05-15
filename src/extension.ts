import * as vscode from "vscode";
import { SocketManager } from "./socket";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider, StudentTreeItem } from "./treeView";
import { CodeSyncChatPanel } from "./chatPanel";

// --- VARIABLES GLOBALES ---
let socketManager: SocketManager;
let treeDataProvider: StudentDataProvider;
let codeProvider: CodeSyncProvider;
let statusBarItem: vscode.StatusBarItem;
let changeTimeout: NodeJS.Timeout | undefined;
let currentRoomId: string | undefined;
let currentUserName: string | undefined;
let isTeacher: boolean = false;

// Exportamos para que socket.ts pueda refrescar las webviews en tiempo real
export const previews = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  console.log("--- [CodeSync]: Sistema Activado ---");

  // 0. RESET DE INTERFAZ (Seguridad al iniciar)
  vscode.commands.executeCommand("setContext", "isCodeSyncJoined", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncTeacher", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncStudent", false);

  // 1. INICIALIZAR CORE
  socketManager = new SocketManager("http://localhost:3000", context);
  codeProvider = new CodeSyncProvider(socketManager);
  treeDataProvider = new StudentDataProvider();

  // Conectamos los proveedores al gestor de sockets
  socketManager.setProviders(codeProvider, treeDataProvider);

  // --- FUNCIONES DE APOYO (HELPERS) ---

  /**
   * (Alumno) Envía la lista de nombres de archivos para el árbol visual.
   */
  const refreshAndSendTree = async () => {
    if (isTeacher || !currentRoomId || !currentUserName) return;

    if (currentRoomId && currentUserName) {
      const files = await vscode.workspace.findFiles(
        "**/*",
        "**/node_modules/**",
      );
      const fileList = files.map((f) => vscode.workspace.asRelativePath(f));

      socketManager.emit("refresh-file-tree", {
        roomId: currentRoomId,
        name: currentUserName,
        files: fileList,
      });
    }
  };

  /**
   * (Docente) Envía un archivo específico codificado en Base64.
   */
  async function sendFile(uri: vscode.Uri, targetStudentId?: string) {
    try {
      const fileData = await vscode.workspace.fs.readFile(uri);
      const base64Content = Buffer.from(fileData).toString("base64");
      const fileName = vscode.workspace.asRelativePath(uri);

      socketManager.emit("teacher-create-file", {
        roomId: currentRoomId,
        studentId: targetStudentId,
        fileName,
        initialContent: base64Content,
        isBinary: true,
      });

      return fileName;
    } catch (err) {
      console.error(`[CodeSync]: Error al leer archivo: ${uri.fsPath}`, err);
      return null;
    }
  }

  // 2. CONFIGURAR STATUS BAR PRINCIPAL
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "code-sync.joinRoom";
  statusBarItem.text = "$(broadcast) CodeSync: Conectar";
  statusBarItem.show();

  // 3. REGISTRAR VISTAS (TreeView)
  const treeView = vscode.window.createTreeView("studentsList", {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });

  // --- COMANDOS PRINCIPALES ---

  // Comando: Unirse a Sala
  let joinCommand = vscode.commands.registerCommand(
    "code-sync.joinRoom",
    async () => {
      const roomId = await vscode.window.showInputBox({
        prompt: "ID de la Sala",
        ignoreFocusOut: true,
      });
      const name = await vscode.window.showInputBox({
        prompt: "Tu Nombre Completo",
        ignoreFocusOut: true,
      });

      if (roomId && name) {
        // Limpieza profunda de sesión anterior
        treeDataProvider.clearAll();
        codeProvider.clearAll();
        previews.forEach((panel) => panel.dispose());
        previews.clear();

        currentRoomId = roomId;
        currentUserName = name;

        isTeacher =
          name.toLowerCase().includes("draconisking") ||
          name.toLowerCase().includes("profe");

        vscode.commands.executeCommand("setContext", "isCodeSyncJoined", true);
        vscode.commands.executeCommand(
          "setContext",
          "isCodeSyncTeacher",
          isTeacher,
        );
        vscode.commands.executeCommand(
          "setContext",
          "isCodeSyncStudent",
          !isTeacher,
        );

        socketManager.joinRoom(roomId, name, isTeacher ? "teacher" : "student");

        if (isTeacher) {
          statusBarItem.text = `$(shield) Profesor: ${roomId}`;
          statusBarItem.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground",
          );
        } else {
          statusBarItem.text = `$(check) Estudiante: ${roomId}`;
          statusBarItem.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.remoteBackground",
          );
          await refreshAndSendTree();
        }
        vscode.window.showInformationMessage(
          `Conectado como ${isTeacher ? "Docente" : "Estudiante"}`,
        );
      }
    },
  );

  // Comando: Abrir archivo del estudiante (Solo Profe)
  let openFileCommand = vscode.commands.registerCommand(
    "code-sync.openStudentFile",
    async (studentId: string, filePath: string) => {
      const uri = CodeSyncProvider.createUri(studentId, filePath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showErrorMessage(
          `No se pudo abrir el archivo virtual: ${filePath}`,
        );
      }
    },
  );

  // Comando: Vista previa HTML en tiempo real (Solo Profe)
  let previewCommand = vscode.commands.registerCommand(
    "code-sync.previewHtml",
    (item: StudentTreeItem) => {
      if (!item.studentId || !item.filePath) return;
      const uriString = CodeSyncProvider.createUri(
        item.studentId,
        item.filePath,
      ).toString();

      if (previews.has(uriString)) {
        previews.get(uriString)?.reveal(vscode.ViewColumn.Two);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "htmlPreview",
        `Vista: ${item.label}`,
        vscode.ViewColumn.Two,
        { enableScripts: true },
      );
      panel.webview.html =
        codeProvider.getContent(uriString) ||
        "<h1>Sincronizando código...</h1>";
      panel.onDidDispose(() => previews.delete(uriString));
      previews.set(uriString, panel);
    },
  );

  // --- COMANDOS DE ENVÍO ---

  let sendActiveAll = vscode.commands.registerCommand(
    "code-sync.sendActiveFileToAll",
    async () => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;
      if (uri && uri.scheme === "file") {
        const fileName = await sendFile(uri);
        if (fileName)
          vscode.window.showInformationMessage(
            `🚀 '${fileName}' enviado a todos.`,
          );
      }
    },
  );

  let sendActiveOne = vscode.commands.registerCommand(
    "code-sync.sendActiveFileToStudent",
    async (item: StudentTreeItem) => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;
      if (uri && uri.scheme === "file" && item.studentId) {
        const fileName = await sendFile(uri, item.studentId);
        if (fileName)
          vscode.window.showInformationMessage(
            `📤 '${fileName}' enviado a ${item.label}.`,
          );
      }
    },
  );

  let sendAllTabs = vscode.commands.registerCommand(
    "code-sync.sendAllTabsToAll",
    async () => {
      const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
      const localUris = allTabs
        .map((tab) => (tab.input as any)?.uri)
        .filter((uri) => uri && uri.scheme === "file");

      if (localUris.length === 0) return;

      const uniqueUris = Array.from(
        new Set(localUris.map((u) => u.toString())),
      ).map((s) => vscode.Uri.parse(s));
      const btnConfirmar = "Sí, enviar todo";
      const ok = await vscode.window.showWarningMessage(
        `¿Enviar estos ${uniqueUris.length} archivos a toda la sala?`,
        btnConfirmar,
        "No",
      );

      if (ok === btnConfirmar) {
        for (const uri of uniqueUris) await sendFile(uri);
        vscode.window.showInformationMessage(
          `📦 Sincronización masiva completada.`,
        );
      }
    },
  );

  // --- COMANDOS DEL DESAFÍO ---

  let startTimerCmd = vscode.commands.registerCommand(
    "code-sync.startTimer",
    async () => {
      const minutes = await vscode.window.showInputBox({
        prompt: "⏳ ¿Minutos del desafío?",
      });
      if (minutes && currentRoomId) {
        socketManager.emit("start-timer", {
          roomId: currentRoomId,
          minutes: parseInt(minutes),
        });
      }
    },
  );

  let sendSnapshotCmd = vscode.commands.registerCommand(
    "code-sync.sendFullProjectSnapshot",
    async () => {
      if (isTeacher) {
        console.log(
          "[CodeSync]: Snapshot cancelado. El docente no envía entregas.",
        );
        return;
      }

      const files = await vscode.workspace.findFiles(
        "**/*",
        "**/node_modules/**",
      );

      const payload: { path: string; content: string }[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CodeSync: Realizando entrega final...",
          cancellable: false,
        },
        async () => {
          for (const file of files) {
            try {
              const content = await vscode.workspace.fs.readFile(file);
              payload.push({
                path: vscode.workspace.asRelativePath(file),
                content: Buffer.from(content).toString("base64"),
              });
            } catch (e) {
              console.error(
                `Error al leer archivo para entrega: ${file.fsPath}`,
              );
            }
          }

          socketManager.emit("student-submit-task", {
            roomId: currentRoomId,
            name: currentUserName,
            files: payload,
          });

          vscode.window.showInformationMessage(
            "📦 Entrega final enviada al profesor.",
          );
        },
      );
    },
  );

  let helpCommand = vscode.commands.registerCommand(
    "code-sync.showHelp",
    () => {
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.file(context.asAbsolutePath("INSTRUCCIONES.md")),
      );
    },
  );

  // COMANDO PARA EL ALUMNO (Botón en el Explorer)
  let requestHelpCmd = vscode.commands.registerCommand(
    "code-sync.requestHelp",
    () => {
      if (isTeacher) return;
      socketManager.emit("request-help", {});
      vscode.window.showInformationMessage(
        "✋ Has levantado la mano. El profe te atenderá pronto.",
      );
    },
  );

  // COMANDO PARA EL PROFESOR (Clic derecho -> Resuelto)
  let resolveHelpCmd = vscode.commands.registerCommand(
    "code-sync.resolveHelp",
    (item: StudentTreeItem) => {
      if (item.studentId) {
        socketManager.emit("resolve-help", { studentId: item.studentId });
      }
    },
  );

  let internalRefreshCmd = vscode.commands.registerCommand(
    "code-sync.internalRefreshTree",
    () => {
      if (
        currentRoomId &&
        currentUserName &&
        !currentUserName.toLowerCase().includes("profe")
      )
        refreshAndSendTree();
    },
  );

  // Comando para abrir el panel de Chat
  let openChatCmd = vscode.commands.registerCommand(
    "code-sync.openChat",
    () => {
      CodeSyncChatPanel.createOrShow(context.extensionUri);

      // Escuchar lo que la Webview envía hacia afuera
      CodeSyncChatPanel.currentPanel?.["_panel"].webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "send") {
            socketManager.emitChat(message.text); // Enviar al servidor
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  // --- VIGILANCIA (LISTENERS) ---

  const onType = vscode.workspace.onDidChangeTextDocument((e) => {
    if (isTeacher || !currentRoomId || e.contentChanges.length === 0) return;
    if (changeTimeout) clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      socketManager.emit("code-update", {
        roomId: currentRoomId,
        filePath: vscode.workspace.asRelativePath(e.document.uri),
        content: e.document.getText(),
      });
    }, 300);
  });

  const fsWatcher = vscode.workspace.createFileSystemWatcher("**/*");
  fsWatcher.onDidCreate(() => {
    if (!isTeacher) refreshAndSendTree();
  });
  fsWatcher.onDidDelete(() => {
    if (!isTeacher) refreshAndSendTree();
  });
  fsWatcher.onDidChange(() => {
    if (!isTeacher) refreshAndSendTree();
  });

  // --- REGISTRO DE SUBSCRIPCIONES ---

  context.subscriptions.push(
    statusBarItem,
    treeView,
    joinCommand,
    openFileCommand,
    previewCommand,
    sendActiveAll,
    sendActiveOne,
    sendAllTabs,
    startTimerCmd,
    sendSnapshotCmd,
    helpCommand,
    requestHelpCmd,
    resolveHelpCmd,
    internalRefreshCmd,
    openChatCmd,
    onType,
    fsWatcher,
    vscode.workspace.registerTextDocumentContentProvider(
      CodeSyncProvider.scheme,
      codeProvider,
    ),
  );
}

export function deactivate() {
  if (changeTimeout) clearTimeout(changeTimeout);
}
