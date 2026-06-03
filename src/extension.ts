import * as vscode from 'vscode';
import { SocketManager } from './socket';
import { CodeSyncProvider } from './provider';
import { StudentDataProvider, StudentTreeItem } from './treeView';
import { CodeSyncChatPanel } from './chatPanel';
import { CodeSyncDashboard } from './dashboardPanel';
import * as path from 'path';

// --- VARIABLES DE CONTROL CORE EXPORTADAS ---
export let treeDataProvider: StudentDataProvider;
export let statusBarItem: vscode.StatusBarItem;

// --- MEMORIA VOLÁTIL DE SERVICIOS INTERNOS ---
let socketManager: SocketManager;
let codeProvider: CodeSyncProvider;

// --- ESTADO DE SESIÓN DINÁMICA PERSISTENTE ---
let changeTimeout: NodeJS.Timeout | undefined;
let wmpInterval: NodeJS.Timeout | undefined;
let currentRoomId: string | undefined;
let currentUserName: string | undefined;
let isTeacher: boolean = false;
let keystrokeCount = 0;

export let focusTimeMs = 0;
export let unfocusTimeMs = 0;
export let lastFocusChangeTimestamp = Date.now();
export let isCurrentlyFocused = true;
export let isTimerActiveForFocus = false;

export const startFocusTracking = () => {
  focusTimeMs = 0;
  unfocusTimeMs = 0;
  lastFocusChangeTimestamp = Date.now();
  isCurrentlyFocused = vscode.window.state.focused;
  isTimerActiveForFocus = true;
};

export const stopFocusTracking = () => {
  if (!isTimerActiveForFocus) return;
  const now = Date.now();
  const elapsed = now - lastFocusChangeTimestamp;
  if (isCurrentlyFocused) focusTimeMs += elapsed;
  else unfocusTimeMs += elapsed;
  lastFocusChangeTimestamp = now;
  isTimerActiveForFocus = false;
};

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
  if (treeRefreshTimeout) clearTimeout(treeRefreshTimeout);
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
  const config = vscode.workspace.getConfiguration('codeSync');
  const serverUrl = config.get<string>('codeSync.serverUrl') || 'https://code-sync-server-fcvk.onrender.com';

  // 1. Inicializamos primero la barra de estado base para alojarla en la memoria de la UI
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'code-sync.joinRoom';
  statusBarItem.text = '$(broadcast) CodeSync: Conectar';
  statusBarItem.show();

  // 2. Rompemos la dependencia circular inyectando la barra de estado directamente al constructor
  socketManager = new SocketManager(serverUrl, context, statusBarItem);
  codeProvider = new CodeSyncProvider(socketManager);
  treeDataProvider = new StudentDataProvider();

  socketManager.setProviders(codeProvider, treeDataProvider);
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

let treeRefreshTimeout: NodeJS.Timeout | undefined;

export const refreshAndSendTree = async () => {
  if (isTeacher || !currentRoomId || !currentUserName) return;

  if (treeRefreshTimeout) clearTimeout(treeRefreshTimeout);

  treeRefreshTimeout = setTimeout(async () => {
    try {
      const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
      const fileList = files.map((f) => vscode.workspace.asRelativePath(f));

      socketManager.emit('refresh-file-tree', {
        roomId: currentRoomId,
        name: currentUserName,
        files: fileList,
      });
    } catch (e) {
      console.error('[CodeSync]: Error en escaneo de árbol', e);
    }
  }, 1500);
};

async function distributeFileToAll(uri: vscode.Uri): Promise<string | null> {
  try {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const base64Content = Buffer.from(fileData).toString('base64');
    const fileName = vscode.workspace.asRelativePath(uri);

    socketManager.emit('teacher-create-file', {
      roomId: currentRoomId,
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

    let relativeFilePath = 'Archivo no especificado';
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
      const fullPath = activeEditor.document.uri.fsPath;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

      if (workspaceFolder) {
        relativeFilePath = path.relative(workspaceFolder.uri.fsPath, fullPath).replace(/\\/g, '/');
      } else {
        relativeFilePath = path.basename(fullPath);
      }
    }

    socketManager.emit('student-wpm-update', {
      roomId: currentRoomId,
      wpm: currentWPM,
      isCopyPaste: detectedCopyPaste,
      filePath: relativeFilePath,
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
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage(
        'CodeSync Error: Debes abrir una carpeta o directorio de trabajo en VS Code antes de unirte a una sala.',
      );
      return;
    }

    const roomId = await vscode.window.showInputBox({
      title: 'Conectarse a la Clase',
      prompt: 'Escribe el código de la sala provisto por el docente',
      placeHolder: 'Ejemplo: LAB-404, PROGRAMACION_AVANZADA',
      ignoreFocusOut: true,
      validateInput: (val) => (val.trim() ? null : 'Error: Campo obligatorio para ubicar el clúster.'),
    });
    if (!roomId) return;

    const name = await vscode.window.showInputBox({
      title: 'Identificación de Sesión',
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

  // Comando: Distribución masiva del entorno de trabajo a todos los estudiantes
  const sendWorkspaceCmd = vscode.commands.registerCommand('code-sync.sendWorkspaceToAll', async () => {
    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    if (files.length === 0) {
      vscode.window.showWarningMessage('No hay archivos en tu área de trabajo para enviar.');
      return;
    }

    const btnConfirmar = 'Sí, distribuir proyecto base';
    const ok = await vscode.window.showWarningMessage(
      `¿Deseas enviar tus ${files.length} archivos a TODA la sala? Los estudiantes recibirán una alerta si el archivo ya existe.`,
      { modal: true },
      btnConfirmar
    );

    if (ok === btnConfirmar) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'CodeSync: Distribuyendo archivos a la clase...',
          cancellable: false,
        },
        async () => {
          for (const uri of files) {
            await distributeFileToAll(uri);
          }
        }
      );
      vscode.window.showInformationMessage(`Proyecto distribuido con éxito a todos los estudiantes.`);
    }
  });

  // Comandos de Exámenes y Cronómetros
  const startTimerCmd = vscode.commands.registerCommand('code-sync.startTimer', async () => {
    const minutes = await vscode.window.showInputBox({
      prompt: 'Duración establecida para el desafío técnico (Minutos):',
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

        if (isTimerActiveForFocus) stopFocusTracking();

        socketManager.emit('student-submit-task', {
          roomId: currentRoomId,
          name: currentUserName,
          files: payload,
          focusStats: { activeMs: focusTimeMs, inactiveMs: unfocusTimeMs }
        });
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
    vscode.window.showInformationMessage('Has solicitado asistencia técnica presencial.');
  });

  const kickStudentCmd = vscode.commands.registerCommand('code-sync.kickStudent', async (node: any) => {
    if (!isTeacher) return;
    const confirm = await vscode.window.showWarningMessage(
      `¿Estás seguro de expulsar a ${node.label}?`,
      { modal: true },
      'Sí, Expulsar'
    );
    if (confirm === 'Sí, Expulsar') {
      socketManager.emit('kick-student', { studentId: node.studentId });
      vscode.window.showInformationMessage(`Has expulsado a ${node.label} de la sala.`);
    }
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
            socketManager.emit('request-desktop-screenshot', { studentName: message.studentName, roomId: message.roomId });
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

  // Iniciar Desafíos
  const reopenWebPanelCommand = vscode.commands.registerCommand('code-sync.reopenWebPanel', () => {
    if (!socketManager) return;

    const name = socketManager.getCurrentUserName();
    const roomId = socketManager.getCurrentRoomId();
    const role = socketManager.getUserRole();

    if (!roomId || !name) {
      vscode.window.showWarningMessage('⚠️ CodeSync: No se detectó ninguna sesión activa para abrir el panel.');
      return;
    }

    if (role === 'student') {
      const encodedName = encodeURIComponent(name);
      const encodedRoom = encodeURIComponent(roomId);
      const urlDestino = `https://code-sync-client-flax.vercel.app/?room=${encodedRoom}&name=${encodedName}`;

      console.log(`[CodeSync UX]: Abriendo panel de desafíos solicitado: ${urlDestino}`);
      vscode.env.openExternal(vscode.Uri.parse(urlDestino));
    }
  });

  context.subscriptions.push(
    joinCommand,
    openFileCommand,
    previewCommand,
    sendWorkspaceCmd,
    startTimerCmd,
    stopTimerCmd,
    sendSnapshotCmd,
    helpCommand,
    requestHelpCmd,
    kickStudentCmd,
    resolveHelpCmd,
    internalRefreshCmd,
    openChatCmd,
    openDashboardCmd,
    reopenWebPanelCommand,
  );
}

// =================================================================
// 🕵️ HOOKS Y VIGILANTES DE ENTORNO EN SEGUNDO PLANO
// =================================================================

function setupBackgroundTelemetryWatchers(context: vscode.ExtensionContext) {
  const focusWatcher = vscode.window.onDidChangeWindowState((state) => {
    if (isTeacher || !currentRoomId) return;

    if (isTimerActiveForFocus) {
      const now = Date.now();
      const elapsed = now - lastFocusChangeTimestamp;
      if (isCurrentlyFocused) focusTimeMs += elapsed;
      else unfocusTimeMs += elapsed;
      isCurrentlyFocused = state.focused;
      lastFocusChangeTimestamp = now;
    }

    socketManager.emit('student-focus-change', { roomId: currentRoomId, isFocused: state.focused });
  });

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
    }, 300);
  });

  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (isTeacher || !currentRoomId || !editor || editor.document.uri.scheme !== 'file') return;

    socketManager.emit('student-active-file-change', {
      roomId: currentRoomId,
      filePath: vscode.workspace.asRelativePath(editor.document.uri),
    });
  });

  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fsWatcher.onDidCreate(() => { if (!isTeacher) refreshAndSendTree(); });
  fsWatcher.onDidDelete(() => { if (!isTeacher) refreshAndSendTree(); });

  context.subscriptions.push(
    focusWatcher,
    onType,
    activeEditorWatcher,
    fsWatcher,
    vscode.workspace.registerTextDocumentContentProvider(CodeSyncProvider.scheme, codeProvider),
  );
}