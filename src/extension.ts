import * as vscode from "vscode";
import { SocketManager } from "./socket";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider, StudentTreeItem } from "./treeView";

// --- VARIABLES GLOBALES ---
let socketManager: SocketManager;
let treeDataProvider: StudentDataProvider;
let statusBarItem: vscode.StatusBarItem;
let changeTimeout: NodeJS.Timeout | undefined;
let currentRoomId: string | undefined;
let currentUserName: string | undefined;

// Exportamos para que socket.ts pueda refrescar las webviews en tiempo real
export const previews = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  console.log("--- [CodeSync]: Sistema Activado ---");

  // 0. RESET DE INTERFAZ
  vscode.commands.executeCommand("setContext", "isCodeSyncJoined", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncTeacher", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncStudent", false);

  // 1. INICIALIZAR CORE
  socketManager = new SocketManager("http://localhost:3000");
  const codeProvider = new CodeSyncProvider(socketManager);
  treeDataProvider = new StudentDataProvider();

  // Conectamos los proveedores al gestor de sockets
  socketManager.setProviders(codeProvider, treeDataProvider);

  // --- FUNCIONES DE APOYO (HELPERS) ---

  const refreshAndSendTree = async () => {
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

  // 2. CONFIGURAR STATUS BAR
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "code-sync.joinRoom";
  statusBarItem.text = "$(broadcast) CodeSync: Conectar";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 3. REGISTRAR VISTAS (TreeView)
  const treeView = vscode.window.createTreeView("studentsList", {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // 4. REGISTRAR PROVEEDOR VIRTUAL
  const providerRegistration =
    vscode.workspace.registerTextDocumentContentProvider(
      CodeSyncProvider.scheme,
      codeProvider,
    );

  // --- COMANDOS PRINCIPALES ---

  let joinCommand = vscode.commands.registerCommand(
    "code-sync.joinRoom",
    async () => {
      const roomId = await vscode.window.showInputBox({
        prompt: "ID de la Sala",
        placeHolder: "Ejemplo: Algoritmos-101",
        ignoreFocusOut: true,
      });
      const name = await vscode.window.showInputBox({
        prompt: "Tu Nombre Completo",
        placeHolder: "Ejemplo: Juan Pérez",
        ignoreFocusOut: true,
      });

      if (roomId && name) {
        // Si el estudiante ya estaba en una sala, podemos limpiar su consola para que no se confunda
        console.log(
          `[CodeSync]: Cambiando de sala ${currentRoomId} -> ${roomId}`,
        );

        // Limpieza de sala previa
        treeDataProvider.clearAll();
        previews.forEach((panel) => panel.dispose());
        previews.clear();

        currentRoomId = roomId;
        currentUserName = name;

        const isTeacher = name.toLowerCase().includes("draconisking");
        const role = isTeacher ? "teacher" : "student";

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

        socketManager.joinRoom(roomId, name, role);

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
        vscode.window.showInformationMessage(`Conectado como ${role}`);
      }
    },
  );

  let openFileCommand = vscode.commands.registerCommand(
    "code-sync.openStudentFile",
    async (studentId: string, filePath: string) => {
      const uri = CodeSyncProvider.createUri(studentId, filePath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showErrorMessage(`No se pudo abrir: ${filePath}`);
      }
    },
  );

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
        `Preview: ${item.label}`,
        vscode.ViewColumn.Two,
        { enableScripts: true },
      );
      panel.webview.html =
        codeProvider.getContent(uriString) || "<h1>Cargando código...</h1>";
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

      if (!uri || uri.scheme !== "file") {
        vscode.window.showErrorMessage("Abre un archivo local para enviar.");
        return;
      }
      const fileName = await sendFile(uri);
      if (fileName)
        vscode.window.showInformationMessage(
          `🚀 '${fileName}' enviado a todos.`,
        );
    },
  );

  let sendActiveOne = vscode.commands.registerCommand(
    "code-sync.sendActiveFileToStudent",
    async (item: StudentTreeItem) => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;

      if (!uri || !item.studentId || uri.scheme !== "file") {
        vscode.window.showErrorMessage("Abre un archivo local para enviar.");
        return;
      }
      const fileName = await sendFile(uri, item.studentId);
      if (fileName)
        vscode.window.showInformationMessage(
          `📤 '${fileName}' enviado a ${item.label}.`,
        );
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

  let helpCommand = vscode.commands.registerCommand(
    "code-sync.showHelp",
    () => {
      const helpUri = vscode.Uri.file(
        context.asAbsolutePath("INSTRUCCIONES.md"),
      );
      vscode.commands.executeCommand("markdown.showPreview", helpUri);
    },
  );

  // --- PROTOCOLO DE RECONEXIÓN Y VIGILANCIA ---

  let internalRefreshCmd = vscode.commands.registerCommand(
    "code-sync.internalRefreshTree",
    () => {
      const isTeacher =
        currentUserName?.toLowerCase().includes("draconisking") ||
        currentUserName?.toLowerCase().includes("profe");
      if (!isTeacher && currentRoomId) refreshAndSendTree();
    },
  );

  const onType = vscode.workspace.onDidChangeTextDocument((e) => {
    if (!currentRoomId || e.contentChanges.length === 0) return;
    if (changeTimeout) clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      socketManager.emit("code-update", {
        roomId: currentRoomId,
        filePath: vscode.workspace.asRelativePath(e.document.uri),
        content: e.document.getText(),
      });
    }, 300);
  });

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  watcher.onDidCreate(() => refreshAndSendTree());
  watcher.onDidDelete(() => refreshAndSendTree());

  context.subscriptions.push(
    joinCommand,
    helpCommand,
    openFileCommand,
    previewCommand,
    sendActiveAll,
    sendActiveOne,
    sendAllTabs,
    internalRefreshCmd,
    onType,
    watcher,
    providerRegistration,
  );
}

export function deactivate() {
  if (changeTimeout) clearTimeout(changeTimeout);
}
