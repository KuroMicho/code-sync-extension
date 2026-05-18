import * as vscode from "vscode";
import { SocketManager } from "./socket";
import { CodeSyncProvider } from "./provider";
import { StudentDataProvider, StudentTreeItem } from "./treeView";
import { CodeSyncChatPanel } from "./chatPanel";
import { CodeSyncDashboard } from "./dashboardPanel";

// --- VARIABLES GLOBALES DE SESIÓN ---
let socketManager: SocketManager;
let treeDataProvider: StudentDataProvider;
let codeProvider: CodeSyncProvider;
let statusBarItem: vscode.StatusBarItem;
let changeTimeout: NodeJS.Timeout | undefined;
let currentRoomId: string | undefined;
let currentUserName: string | undefined;
let isTeacher: boolean = false;
let keystrokeCount = 0;
let wmpInterval: NodeJS.Timeout | undefined;

// Exportación para que el SocketManager controle de forma reactiva las actualizaciones visuales
export const previews = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  console.log("--- [CodeSync]: Sistema Activado Correctamente ---");

  // 0. RESET DE CONTEXTOS DE INTERFAZ (Garantiza consistencia estética al arrancar)
  vscode.commands.executeCommand("setContext", "isCodeSyncJoined", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncTeacher", false);
  vscode.commands.executeCommand("setContext", "isCodeSyncStudent", false);

  // 1. INICIALIZACIÓN DEL NÚCLEO (Cambiar localhost por tu IP de red local en el aula)
  socketManager = new SocketManager("http://localhost:3000", context);
  codeProvider = new CodeSyncProvider(socketManager);
  treeDataProvider = new StudentDataProvider();

  // Inyección cruzada de dependencias
  socketManager.setProviders(codeProvider, treeDataProvider);

  // --- FUNCIONES DE APOYO (HELPERS DE FLUJO) ---

  /**
   * (Modo Estudiante): Escanea el espacio de trabajo actual y reporta el árbol al profesor.
   */
  const refreshAndSendTree = async () => {
    if (isTeacher || !currentRoomId || !currentUserName) return;

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
  };

  /**
   * (Modo Docente): Lee un archivo físico local y lo transmite codificado en Base64.
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
      console.error(
        `[CodeSync]: Error al procesar archivo de transmisión: ${uri.fsPath}`,
        err,
      );
      return null;
    }
  }

  // 2. CONTEXTO DE LA BARRA DE ESTADO PRINCIPAL
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "code-sync.joinRoom";
  statusBarItem.text = "$(broadcast) CodeSync: Conectar";
  statusBarItem.show();

  // 3. REGISTRO ESTRUCTURAL DEL ÁRBOL LATERAL JERÁRQUICO
  const treeView = vscode.window.createTreeView("studentsList", {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });

  // --- REGISTRO DE TELEMETRÍA (MÉTRICAS LOCALES) ---

  /**
   * (Modo Estudiante): Mide la velocidad de tecleo y activa banderas si hay copy-paste masivo.
   */
  const startWpmTracker = () => {
    if (wmpInterval) clearInterval(wmpInterval);

    wmpInterval = setInterval(() => {
      if (!currentRoomId || isTeacher) return;

      // Fórmula estándar: 5 caracteres equivalen a 1 palabra promedio.
      // Como medimos en ciclos de 5 segundos, multiplicamos por 12 para proyectarlo a 1 minuto (60s).
      const words = keystrokeCount / 5;
      const currentWPM = Math.round(words * 12);

      // Flag de seguridad: Si introduce más de 150 caracteres limpios en 5s, es Copy-Paste
      const detectedCopyPaste = keystrokeCount > 150;

      socketManager.emit("student-wpm-update", {
        roomId: currentRoomId,
        wpm: currentWPM,
        isCopyPaste: detectedCopyPaste,
      });

      // Resetear contador local para los próximos 5 segundos
      keystrokeCount = 0;
    }, 5000);
  };

  // --- REGISTRO DE COMANDOS DE LA EXTENSIÓN ---

  // Comando: Autenticación y acceso a Salas
  let joinCommand = vscode.commands.registerCommand(
    "code-sync.joinRoom",
    async () => {
      // 1. INPUT: ID DE LA SALA
      const roomId = await vscode.window.showInputBox({
        title: "🔑 Conectarse a la Clase",
        prompt: "Escribe el código de la sala que te dio el profesor",
        placeHolder: "Ejemplo: CLASE-AULA3, PROGRAMACION2",
        ignoreFocusOut: true,
        validateInput: (value) => {
          return value.trim()
            ? null
            : "❌ Por favor, escribe el código de la sala para poder ingresar.";
        },
      });

      if (!roomId) return; // Cancela de forma limpia si presionan ESC

      // 2. INPUT: NOMBRE DEL ESTUDIANTE
      const name = await vscode.window.showInputBox({
        title: "👤 Tu Nombre",
        prompt:
          "Escribe tu nombre y apellido completo para que el profe te pueda calificar",
        placeHolder: "Ejemplo: Carlos Mendoza",
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim())
            return "❌ Tu nombre es obligatorio para que tus entregas se guarden con tu nota.";
          if (value.trim().length < 3)
            return "❌ Por favor, escribe tu nombre completo.";
          return null;
        },
      });

      if (roomId && name) {
        // Limpieza atómica de estados locales residuales de sesiones previas
        treeDataProvider.clearAll();
        codeProvider.clearAll();
        previews.forEach((panel) => panel.dispose());
        previews.clear();

        currentRoomId = roomId;
        const inputName = name.trim();

        if (inputName.endsWith("#unipx")) {
          isTeacher = true;
          // Limpiamos la firma para que en logs, chats y UI te muestre impecable de forma pública
          currentUserName = inputName.replace("#unipx", "").trim();
        } else {
          isTeacher = false;
          currentUserName = inputName;
        }

        // Inyección de contextos condicionales para la reactividad del package.json
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

        socketManager.joinRoom(
          roomId,
          currentUserName,
          isTeacher ? "teacher" : "student",
        );

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
          startWpmTracker(); // Inicializa el heartbeat de analíticas
          await refreshAndSendTree();
        }

        vscode.window.showInformationMessage(
          `Conectado con éxito como ${isTeacher ? "Docente" : "Estudiante"}`,
        );
      }
    },
  );

  // Comando: Visualización de ficheros remotos (Solo Docente)
  let openFileCommand = vscode.commands.registerCommand(
    "code-sync.openStudentFile",
    async (studentId: string, filePath: string) => {
      const uri = CodeSyncProvider.createUri(studentId, filePath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showErrorMessage(
          `No se pudo abrir el búfer virtual de: ${filePath}`,
        );
      }
    },
  );

  // Comando: Hot-Reload e inspección Frontend HTML (Solo Docente)
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
        `Vista Previa: ${item.label}`,
        vscode.ViewColumn.Two,
        { enableScripts: true },
      );

      panel.webview.html =
        codeProvider.getContent(uriString) ||
        "<h1>Sincronizando entorno de desarrollo remoto...</h1>";
      panel.onDidDispose(() => previews.delete(uriString));
      previews.set(uriString, panel);
    },
  );

  // --- CONTROL DE ENVÍOS MASIVOS Y DISTRIBUCIÓN ---

  // Enviar archivo activo a toda la clase
  let sendActiveAll = vscode.commands.registerCommand(
    "code-sync.sendActiveFileToAll",
    async () => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;

      if (uri && uri.scheme === "file") {
        const fileName = await sendFile(uri);
        if (fileName) {
          vscode.window.showInformationMessage(
            `🚀 Archivo '${fileName}' distribuido a toda la clase.`,
          );
        }
      }
    },
  );

  // Enviar archivo activo a un estudiante específico (Clic derecho en árbol lateral)
  let sendActiveOne = vscode.commands.registerCommand(
    "code-sync.sendActiveFileToStudent",
    async (item: StudentTreeItem) => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;

      if (uri && uri.scheme === "file" && item.studentId) {
        const fileName = await sendFile(uri, item.studentId);
        if (fileName) {
          vscode.window.showInformationMessage(
            `📤 Archivo '${fileName}' inyectado en el workspace de ${item.label}.`,
          );
        }
      }
    },
  );

  // Enviar todas las pestañas abiertas a todos (Sincronización masiva de guías)
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

      const btnConfirmar = "Sí, iniciar transmisión masiva";
      const ok = await vscode.window.showWarningMessage(
        `¿Deseas enviar este paquete de ${uniqueUris.length} archivos a toda la sala de desarrollo?`,
        btnConfirmar,
        "Cancelar",
      );

      if (ok === btnConfirmar) {
        for (const uri of uniqueUris) await sendFile(uri);
        vscode.window.showInformationMessage(
          `📦 Paquete de sincronización masiva completado.`,
        );
      }
    },
  );

  // --- SECCIÓN: RETOS Y EXÁMENES CRONOMETRADOS ---

  let startTimerCmd = vscode.commands.registerCommand(
    "code-sync.startTimer",
    async () => {
      const minutes = await vscode.window.showInputBox({
        prompt: "⏳ Duración establecida para el desafío técnico (Minutos):",
      });
      if (minutes && currentRoomId) {
        socketManager.emit("start-timer", {
          roomId: currentRoomId,
          minutes: parseInt(minutes),
        });
      }
    },
  );

  let stopTimerCmd = vscode.commands.registerCommand(
    "code-sync.stopTimer",
    () => {
      if (isTeacher && currentRoomId) {
        socketManager.emit("stop-timer", { roomId: currentRoomId });
      }
    },
  );

  let sendSnapshotCmd = vscode.commands.registerCommand(
    "code-sync.sendFullProjectSnapshot",
    async () => {
      if (isTeacher) {
        console.log(
          "[CodeSync]: Snapshot omitido. Cuenta de Docente inmune a entregas.",
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
          title: "CodeSync: Recopilando y estructurando entrega final...",
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
              console.error(`Error de empaquetado en recurso: ${file.fsPath}`);
            }
          }

          socketManager.emit("student-submit-task", {
            roomId: currentRoomId,
            name: currentUserName,
            files: payload,
          });

          vscode.window.showInformationMessage(
            "📦 Snapshot de entrega enviado correctamente al profesor.",
          );
        },
      );
    },
  );

  // --- SOPORTE Y SOLICITUD DE ASISTENCIA ---

  let helpCommand = vscode.commands.registerCommand(
    "code-sync.showHelp",
    () => {
      vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.file(context.asAbsolutePath("INSTRUCCIONES.md")),
      );
    },
  );

  let requestHelpCmd = vscode.commands.registerCommand(
    "code-sync.requestHelp",
    () => {
      if (isTeacher) return;
      socketManager.emit("request-help", {});
      vscode.window.showInformationMessage(
        "✋ Has solicitado asistencia técnica. Tu celda cambiará de estado en el monitor del docente.",
      );
    },
  );

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
      if (currentRoomId && currentUserName && !isTeacher) {
        refreshAndSendTree();
      }
    },
  );

  // --- INTERFAZ MULTI-PANEL (CHAT Y DASHBOARD TÁCTICO) ---

  let openDashboardCmd = vscode.commands.registerCommand(
    "code-sync.openDashboard",
    () => {
      if (!isTeacher) return;
      CodeSyncDashboard.createOrShow();

      // Escuchador táctico: Recibe comandos desde los clics de la interfaz de la Webview del Dashboard
      CodeSyncDashboard.currentPanel?.["_panel"].webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === "openStudent") {
            // Permite al profesor abrir de forma remota la pestaña exacta que el alumno tiene activa
            vscode.commands.executeCommand(
              "code-sync.openStudentFile",
              message.studentId,
              message.filePath || "index.html",
            );
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  let openChatCmd = vscode.commands.registerCommand(
    "code-sync.openChat",
    () => {
      CodeSyncChatPanel.createOrShow(context.extensionUri, isTeacher);

      if (isTeacher) {
        CodeSyncChatPanel.currentPanel?.updateStudentList(
          socketManager.getActiveStudents(),
        );
      }

      CodeSyncChatPanel.currentPanel?.["_panel"].webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "send") {
            socketManager.emitChat(message.text, message.targetId);
          }
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  // --- VIGILANCIA EN SEGUNDO PLANO (LISTENERS ACTIVOS DE VS CODE) ---

  // Telemetría de enfoque: Detecta si el estudiante minimiza VS Code o cambia de ventana
  const focusWatcher = vscode.window.onDidChangeWindowState((windowState) => {
    if (isTeacher || !currentRoomId) return;

    socketManager.emit("student-focus-change", {
      roomId: currentRoomId,
      isFocused: windowState.focused,
    });
  });

  // Monitor de escritura: Captura el delta de caracteres insertados para calcular WPM localmente
  const onType = vscode.workspace.onDidChangeTextDocument((e) => {
    if (isTeacher || !currentRoomId || e.contentChanges.length === 0) return;

    e.contentChanges.forEach((change) => {
      keystrokeCount += change.text.length;
    });

    if (changeTimeout) clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      socketManager.emit("code-update", {
        roomId: currentRoomId,
        filePath: vscode.workspace.asRelativePath(e.document.uri),
        content: e.document.getText(),
      });
    }, 300); // Debounce de 300ms para mitigar saturación de buffers de red inalámbricos
  });

  // Rastreador dinámico de pestañas de edición: Envía al Dashboard qué ruta está inspeccionando el alumno
  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (
        isTeacher ||
        !currentRoomId ||
        !editor ||
        editor.document.uri.scheme !== "file"
      ) {
        return;
      }

      socketManager.emit("student-active-file-change", {
        roomId: currentRoomId,
        filePath: vscode.workspace.asRelativePath(editor.document.uri),
      });
    },
  );

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

  // --- INYECCIÓN Y REGISTRO EN EL SUBSCRIPTIONS-POOL ---
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
    stopTimerCmd,
    sendSnapshotCmd,
    helpCommand,
    requestHelpCmd,
    resolveHelpCmd,
    internalRefreshCmd,
    openChatCmd,
    openDashboardCmd,
    activeEditorWatcher,
    focusWatcher,
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
  if (wmpInterval) clearInterval(wmpInterval);
}
