import * as vscode from 'vscode';
import { SocketManager } from './socket';
import { CodeSyncProvider } from './provider';
import { StudentDataProvider, StudentTreeItem } from './treeView';
import { CodeSyncChatPanel } from './chatPanel';
import { CodeSyncDashboard } from './dashboardPanel';

// --- VARIABLES DE CONTROL CORE EXPORTADAS ---
export let treeDataProvider: StudentDataProvider;
export let statusBarItem: vscode.StatusBarItem;

// --- MEMORIA VOLATIL DE SERVICIOS INTERNOS ---
let socketManager: SocketManager;
let codeProvider: CodeSyncProvider;

// --- ESTADO DE SESIÓN DINÁMICA ---
let changeTimeout: NodeJS.Timeout | undefined;
let wmpInterval: NodeJS.Timeout | undefined;
let currentRoomId: string | undefined;
let currentUserName: string | undefined;
let isTeacher: boolean = false;
let keystrokeCount = 0;

// Exportación reactiva para el control de visualización Frontend Remoto
export const previews = new Map<string, vscode.WebviewPanel>();

/**
 * Punto de entrada principal para la activación de la extensión en VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('--- [CodeSync]: Sistema Activado Correctamente ---');

  initializeUIContexts();
  initializeCoreServices(context);
  setupClassroomTreeExplorer();
  registerClassroomCommands(context);
  setupBackgroundTelemetryWatchers(context);
}

/**
 * Libera buffers y detiene hilos de cómputo remotos al apagar la extensión.
 */
export function deactivate() {
  if (changeTimeout) clearTimeout(changeTimeout);
  if (wmpInterval) clearInterval(wmpInterval);
}

// =================================================================
// ⚙️ INITIALIZERS & SUB-SYSTEM CONFIGURATIONS
// =================================================================

function initializeUIContexts() {
  vscode.commands.executeCommand('setContext', 'isCodeSyncJoined', false);
  vscode.commands.executeCommand('setContext', 'isCodeSyncTeacher', false);
  vscode.commands.executeCommand('setContext', 'isCodeSyncStudent', false);
}

function initializeCoreServices(context: vscode.ExtensionContext) {
  socketManager = new SocketManager('http://localhost:3000', context);
  codeProvider = new CodeSyncProvider(socketManager);
  treeDataProvider = new StudentDataProvider();

  socketManager.setProviders(codeProvider, treeDataProvider);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'code-sync.joinRoom';
  statusBarItem.text = '$(broadcast) CodeSync: Conectar';
  statusBarItem.show();
}

function setupClassroomTreeExplorer() {
  vscode.window.createTreeView('studentsList', {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true,
  });
}

// =================================================================
// 🔒 PIPELINE DE TELEMETRÍA Y CONTROL DE FLUJO LOCAL
// =================================================================

export const refreshAndSendTree = async () => {
  if (isTeacher || !currentRoomId || !currentUserName) return;

  const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
  const fileList = files.map((f) => vscode.workspace.asRelativePath(f));

  socketManager.emit('refresh-file-tree', {
    roomId: currentRoomId,
    name: currentUserName,
    files: fileList,
  });
};

async function sendFile(uri: vscode.Uri, targetStudentId?: string): Promise<string | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const base64Content = Buffer.from(fileData).toString('base64');
    const fileName = vscode.workspace.asRelativePath(uri);

    socketManager.emit('teacher-create-file', {
      roomId: currentRoomId,
      studentId: targetStudentId,
      fileName,
      initialContent: base64Content,
      isBinary: true,
    });

    return fileName;
  } catch (err) {
    console.error(`[CodeSync]: Error al codificar buffer de transmisión: ${uri.fsPath}`, err);
    return null;
  }
}

export const startWpmTracker = () => {
  if (wmpInterval) clearInterval(wmpInterval);

  wmpInterval = setInterval(() => {
    if (!currentRoomId || isTeacher) return;

    const words = keystrokeCount / 5;
    const currentWPM = Math.round(words * 12);
    const detectedCopyPaste = keystrokeCount > 150;

    socketManager.emit('student-wpm-update', {
      roomId: currentRoomId,
      wpm: currentWPM,
      isCopyPaste: detectedCopyPaste,
    });

    keystrokeCount = 0;
  }, 5000);
};

// =================================================================
// 📟 REGISTRO Y GESTIÓN ESTRUCTURAL DE COMANDOS
// =================================================================

function registerClassroomCommands(context: vscode.ExtensionContext) {
  // Comando: Ingreso Seguro y Autenticación de Salas
  const joinCommand = vscode.commands.registerCommand('code-sync.joinRoom', async () => {
    const roomId = await vscode.window.showInputBox({
      title: 'Conectarse a la Clase',
      prompt: 'Escribe el codigo de la sala provisto por el docente',
      placeHolder: 'Ejemplo: LAB-404, PROGRAMACION_AVANZADA',
      ignoreFocusOut: true,
      validateInput: (val) => (val.trim() ? null : 'Error: Campo obligatorio para ubicar el cluster.'),
    });
    if (!roomId) return;

    const name = await vscode.window.showInputBox({
      title: 'Identificacion de Sesion',
      prompt: 'Ingresa tu nombre y apellido completo para la planilla legal',
      placeHolder: 'Ejemplo: Kevin Mendoza',
      ignoreFocusOut: true,
      validateInput: (val) => {
        if (!val.trim()) return 'Error: El nombre es mandatorio para auditar tus notas.';
        if (val.trim().length < 3) return 'Error: Escribe un identificador real.';
        return null;
      },
    });
    if (!name) return;

    // Purga proactiva de sesiones previas en caliente
    treeDataProvider.clearAll();
    codeProvider.clearAll();
    previews.forEach((panel) => panel.dispose());
    previews.clear();

    currentRoomId = roomId;
    const inputName = name.trim();
    isTeacher = inputName.endsWith('#unipx');
    currentUserName = isTeacher ? inputName.replace('#unipx', '').trim() : inputName;

    socketManager.joinRoom(roomId, currentUserName, isTeacher ? 'teacher' : 'student');
  });

  // Comando: Apertura de buffers virtuales remotos
  const openFileCommand = vscode.commands.registerCommand(
    'code-sync.openStudentFile',
    async (studentId: string, filePath: string) => {
      const uri = CodeSyncProvider.createUri(studentId, filePath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showErrorMessage(`Imposible montar el buffer remoto de: ${filePath}`);
      }
    },
  );

  // Comando: Hot-Reload e Inspección Frontend HTML
  const previewCommand = vscode.commands.registerCommand('code-sync.previewHtml', (item: StudentTreeItem) => {
    if (!item.studentId || !item.filePath) return;

    const uriString = CodeSyncProvider.createUri(item.studentId, item.filePath).toString();

    if (previews.has(uriString)) {
      previews.get(uriString)?.reveal(vscode.ViewColumn.Two);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'htmlPreview',
      `Vista Previa: ${item.label}`,
      vscode.ViewColumn.Two,
      { enableScripts: true },
    );
    panel.webview.html = codeProvider.getContent(uriString) || '<h1>Sincronizando entorno de desarrollo remoto...</h1>';
    panel.onDidDispose(() => previews.delete(uriString));
    previews.set(uriString, panel);
  });

  // Comando: Distribución masiva del archivo activo a toda la sala
  const sendActiveAll = vscode.commands.registerCommand('code-sync.sendActiveFileToAll', async () => {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri = (activeTab?.input as any)?.uri;

    if (uri && uri.scheme === 'file') {
      const fileName = await sendFile(uri);
      if (fileName) vscode.window.showInformationMessage(`Archivo '${fileName}' distribuido a toda la clase.`);
    }
  });

  // Comando: Inyección focalizada de archivo a un alumno específico
  const sendActiveOne = vscode.commands.registerCommand(
    'code-sync.sendActiveFileToStudent',
    async (item: StudentTreeItem) => {
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const uri = (activeTab?.input as any)?.uri;

      if (uri && uri.scheme === 'file' && item.studentId) {
        const fileName = await sendFile(uri, item.studentId);
        if (fileName)
          vscode.window.showInformationMessage(`Archivo '${fileName}' inyectado en el workspace de ${item.label}.`);
      }
    },
  );

  // Comando: Sincronización empaquetada de guías de código completas
  const sendAllTabs = vscode.commands.registerCommand('code-sync.sendAllTabsToAll', async () => {
    const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const localUris = allTabs.map((tab) => (tab.input as any)?.uri).filter((uri) => uri && uri.scheme === 'file');

    if (localUris.length === 0) return;

    const uniqueUris = Array.from(new Set(localUris.map((u) => u.toString()))).map((s) => vscode.Uri.parse(s));
    const btnConfirmar = 'Si, iniciar transmision masiva';
    const ok = await vscode.window.showWarningMessage(
      `¿Deseas enviar este paquete de ${uniqueUris.length} archivos a toda la sala de desarrollo?`,
      btnConfirmar,
      'Cancelar',
    );

    if (ok === btnConfirmar) {
      for (const uri of uniqueUris) await sendFile(uri);
      vscode.window.showInformationMessage(`Paquete de sincronizacion masiva completado.`);
    }
  });

  // Comandos de Exámenes y Cronómetros
  const startTimerCmd = vscode.commands.registerCommand('code-sync.startTimer', async () => {
    const minutes = await vscode.window.showInputBox({
      prompt: 'Duracion establecida para el desafio tecnico (Minutos):',
    });
    if (minutes && currentRoomId) {
      socketManager.emit('start-timer', { roomId: currentRoomId, minutes: parseInt(minutes) });
    }
  });

  const stopTimerCmd = vscode.commands.registerCommand('code-sync.stopTimer', () => {
    if (isTeacher && currentRoomId) socketManager.emit('stop-timer', { roomId: currentRoomId });
  });

  const sendSnapshotCmd = vscode.commands.registerCommand('code-sync.sendFullProjectSnapshot', async () => {
    if (isTeacher) return;

    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    const payload: { path: string; content: string }[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CodeSync: Recopilando y empaquetando entrega final...',
        cancellable: false,
      },
      async () => {
        for (const file of files) {
          try {
            const content = await vscode.workspace.fs.readFile(file);
            payload.push({
              path: vscode.workspace.asRelativePath(file),
              content: Buffer.from(content).toString('base64'),
            });
          } catch {
            console.error(`Error de lectura en recurso: ${file.fsPath}`);
          }
        }

        socketManager.emit('student-submit-task', { roomId: currentRoomId, name: currentUserName, files: payload });
        vscode.window.showInformationMessage('Snapshot de entrega enviado correctamente al profesor.');
      },
    );
  });

  // Comandos de Soporte y Mesas de Ayuda
  const helpCommand = vscode.commands.registerCommand('code-sync.showHelp', () => {
    vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(context.asAbsolutePath('INSTRUCCIONES.md')));
  });

  const requestHelpCmd = vscode.commands.registerCommand('code-sync.requestHelp', () => {
    if (isTeacher) return;
    socketManager.emit('request-help', {});
    vscode.window.showInformationMessage('Has solicitado asistencia tecnica presencial.');
  });

  const resolveHelpCmd = vscode.commands.registerCommand('code-sync.resolveHelp', (item: StudentTreeItem) => {
    if (item.studentId) socketManager.emit('resolve-help', { studentId: item.studentId });
  });

  const internalRefreshCmd = vscode.commands.registerCommand('code-sync.internalRefreshTree', () => {
    if (currentRoomId && currentUserName && !isTeacher) refreshAndSendTree();
  });

  // Panel Multidispositivo: Dashboard de Telemetría
  const openDashboardCmd = vscode.commands.registerCommand('code-sync.openDashboard', () => {
    if (!isTeacher) return;
    CodeSyncDashboard.createOrShow();

    CodeSyncDashboard.currentPanel?.['_panel'].webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'requestDashboardSync':
            socketManager.emit('request-dashboard-sync', {});
            break;
          case 'requestScreenshot':
            socketManager.emit('request-desktop-screenshot', { studentName: message.studentName });
            break;
          case 'openStudent':
            vscode.commands.executeCommand(
              'code-sync.openStudentFile',
              message.studentId,
              message.filePath || 'index.html',
            );
            break;
        }
      },
      undefined,
      context.subscriptions,
    );
  });

  // Panel Multidispositivo: Chat Centralizado
  const openChatCmd = vscode.commands.registerCommand('code-sync.openChat', () => {
    CodeSyncChatPanel.createOrShow(context.extensionUri, isTeacher);

    if (isTeacher) {
      CodeSyncChatPanel.currentPanel?.updateStudentList(socketManager.getActiveStudents());
    }

    const historialAcumulado = socketManager.getChatHistory();
    historialAcumulado.forEach((msg) => {
      CodeSyncChatPanel.currentPanel?.addMessage(msg, socketManager.getSocketId());
    });

    CodeSyncChatPanel.currentPanel?.['_panel'].webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'send') socketManager.emitChat(message.text, message.targetId);
      },
      undefined,
      context.subscriptions,
    );
  });

  context.subscriptions.push(
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
  );
}

// =================================================================
// 🕵️ HOOKS Y VIGILANTES DE ENTORNO EN SEGUNDO PLANO
// =================================================================

function setupBackgroundTelemetryWatchers(context: vscode.ExtensionContext) {
  // Auditoría: Estado de Enfoque (Foco de Ventana de Sistema Operativo)
  const focusWatcher = vscode.window.onDidChangeWindowState((state) => {
    if (isTeacher || !currentRoomId) return;
    socketManager.emit('student-focus-change', { roomId: currentRoomId, isFocused: state.focused });
  });

  // Auditoría: Interceptor Debounced de Escritura Activa
  const onType = vscode.workspace.onDidChangeTextDocument((e) => {
    if (isTeacher || !currentRoomId || e.contentChanges.length === 0) return;

    e.contentChanges.forEach((change) => {
      keystrokeCount += change.text.length;
    });

    if (changeTimeout) clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
      socketManager.emit('code-update', {
        roomId: currentRoomId,
        filePath: vscode.workspace.asRelativePath(e.document.uri),
        content: e.document.getText(),
      });
    }, 300); // Debounce de 300ms contra microcortes inalámbricos de aula
  });

  // Auditoría: Rastreador Dinámico del Buffer Abierto por el Alumno
  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (isTeacher || !currentRoomId || !editor || editor.document.uri.scheme !== 'file') return;

    socketManager.emit('student-active-file-change', {
      roomId: currentRoomId,
      filePath: vscode.workspace.asRelativePath(editor.document.uri),
    });
  });

  // Auditoría: Escudo del Árbol de Ficheros Local contra Altas/Bajas del Alumno
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fsWatcher.onDidCreate(() => {
    if (!isTeacher) refreshAndSendTree();
  });
  fsWatcher.onDidDelete(() => {
    if (!isTeacher) refreshAndSendTree();
  });
  fsWatcher.onDidChange(() => {
    if (!isTeacher) refreshAndSendTree();
  });

  context.subscriptions.push(
    focusWatcher,
    onType,
    activeEditorWatcher,
    fsWatcher,
    vscode.workspace.registerTextDocumentContentProvider(CodeSyncProvider.scheme, codeProvider),
  );
}
