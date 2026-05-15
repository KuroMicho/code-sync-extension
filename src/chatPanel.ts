import * as vscode from "vscode";

export class CodeSyncChatPanel {
  public static currentPanel: CodeSyncChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    if (CodeSyncChatPanel.currentPanel) {
      CodeSyncChatPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "codesyncChat",
      "📟 CODESYNC :: CHAT_ROOM",
      vscode.ViewColumn.Two, // Abre a la derecha
      { enableScripts: true, retainContextWhenHidden: true },
    );

    CodeSyncChatPanel.currentPanel = new CodeSyncChatPanel(panel, extensionUri);
  }

  // Método para inyectar mensajes desde el SocketManager
  public addMessage(data: any) {
    this._panel.webview.postMessage({ command: "receive", ...data });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body { 
                        background-color: #0d0d0d; 
                        color: #00ffcc; 
                        font-family: 'Courier New', monospace; 
                        display: flex; flex-direction: column; height: 100vh; margin: 0; padding: 15px;
                        box-sizing: border-box;
                    }
                    #chat-container { flex-grow: 1; overflow-y: auto; border: 1px solid #00ffcc; padding: 10px; margin-bottom: 10px; box-shadow: inset 0 0 10px #00ffcc33; }
                    .msg { margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; animation: fadeIn 0.3s ease; }
                    .profe { color: #ff0080; text-shadow: 0 0 5px #ff0080; }
                    .alumno { color: #00ffcc; }
                    .timestamp { font-size: 0.8em; opacity: 0.5; margin-right: 8px; }
                    #input-container { display: flex; gap: 5px; }
                    input { 
                        flex-grow: 1; background: #1a1a1a; border: 1px solid #ff0080; color: #ff0080; padding: 10px; 
                        outline: none; font-family: inherit;
                    }
                    input:focus { box-shadow: 0 0 10px #ff0080; }
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                </style>
            </head>
            <body>
                <div style="font-size: 0.7em; margin-bottom: 5px; color: #ff0080;">> CHANNEL_ESTABLISHED // ENCRYPTED_MODE</div>
                <div id="chat-container"></div>
                <div id="input-container">
                    <input type="text" id="msgInput" placeholder="Escribe un comando o mensaje..." />
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const container = document.getElementById('chat-container');
                    const input = document.getElementById('msgInput');

                    // Recibir del SocketManager
                    window.addEventListener('message', event => {
                        const { command, sender, message, timestamp, role } = event.data;
                        if (command === 'receive') {
                            const div = document.createElement('div');
                            div.className = 'msg';
                            const tag = role === 'teacher' ? 'profe' : 'alumno';
                            div.innerHTML = \`<span class="timestamp">[\${timestamp}]</span><span class="\${tag}">\${sender}:</span> \${message}\`;
                            container.appendChild(div);
                            container.scrollTop = container.scrollHeight;
                        }
                    });

                    // Enviar al SocketManager
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            vscode.postMessage({ command: 'send', text: input.value });
                            input.value = '';
                        }
                    });
                </script>
            </body>
            </html>`;
  }

  public dispose() {
    CodeSyncChatPanel.currentPanel = undefined;
    this._panel.dispose();
  }
}
