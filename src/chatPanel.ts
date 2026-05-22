import * as vscode from 'vscode';

export class CodeSyncChatPanel {
  public static currentPanel: CodeSyncChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _isTeacher: boolean = false;

  private constructor(panel: vscode.WebviewPanel, isTeacher: boolean) {
    this._panel = panel;
    this._isTeacher = isTeacher;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtmlForWebview();
  }

  public static createOrShow(extensionUri: vscode.Uri, isTeacher: boolean) {
    if (CodeSyncChatPanel.currentPanel) {
      CodeSyncChatPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codesyncChat',
      isTeacher ? '📟 CODESYNC :: CONTROL_PANEL_CHAT' : '📟 CODESYNC :: STUDENT_CHAT',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    CodeSyncChatPanel.currentPanel = new CodeSyncChatPanel(panel, isTeacher);
  }

  public addMessage(data: any, myOpenId: string) {
    this._panel.webview.postMessage({ command: 'receive', ...data, myOpenId });
  }

  public updateStudentList(students: { id: string; name: string }[]) {
    if (this._isTeacher) {
      this._panel.webview.postMessage({ command: 'updateStudents', students });
    }
  }

  private _getHtmlForWebview() {
    return `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <style>
                    body { 
                        background-color: #0a0a0c; color: #00ffcc; 
                        font-family: 'Courier New', monospace; display: flex; flex-direction: column; 
                        height: 100vh; margin: 0; padding: 12px; box-sizing: border-box;
                    }
                    #chat-container { 
                        flex-grow: 1; overflow-y: auto; border: 1px solid #00ffcc; 
                        padding: 10px; margin-bottom: 10px; box-shadow: inset 0 0 15px #00ffcc22; 
                        background: #0d0d11;
                    }
                    .msg { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #1a1a24; font-size: 0.95em; line-height: 1.3em;}
                    .timestamp { color: #555577; margin-right: 6px; font-size: 0.85em; }
                    
                    /* Roles del sistema */
                    .tag-profe { color: #ff0080; text-shadow: 0 0 4px #ff0080; font-weight: bold; }
                    .tag-alumno { color: #00ffcc; cursor: pointer; font-weight: bold; }
                    .tag-alumno:hover { text-decoration: underline; text-shadow: 0 0 5px #00ffcc; }
                    
                    /* Variaciones de contexto de mensajes */
                    .system-msg { color: #ffff00; font-style: italic; }
                    .private-badge { background: #ff008033; color: #ff0080; padding: 2px 5px; font-size: 0.75em; border-radius: 3px; margin-right: 5px; border: 1px solid #ff008055;}
                    .me { background: #00ffcc08; }

                    #controls-container { display: flex; flex-direction: column; gap: 6px; }
                    #targetSelect { 
                        background: #121216; color: #ff0080; border: 1px solid #ff008055; 
                        padding: 6px; font-family: inherit; outline: none; box-shadow: 0 0 5px #ff008011;
                        display: ${this._isTeacher ? 'block' : 'none'};
                    }
                    #targetSelect:focus { border-color: #ff0080; box-shadow: 0 0 8px #ff008044; }
                    #input-row { display: flex; gap: 6px; }
                    input { 
                        flex-grow: 1; background: #121216; border: 1px solid #00ffcc55; 
                        color: #00ffcc; padding: 10px; outline: none; font-family: inherit;
                    }
                    input:focus { border-color: #00ffcc; box-shadow: 0 0 8px #00ffcc44; }
                </style>
            </head>
            <body>
                <div style="font-size: 0.75em; margin-bottom: 6px; color: #555577;">> TERMINAL_CHAT // CONEXIÓN_ESTABLECIDA</div>
                <div id="chat-container"></div>
                
                <div id="controls-container">
                    <select id="targetSelect">
                        <option value="">📢 Enviar a: TODA LA CLASE</option>
                    </select>
                    <div id="input-row">
                        <input type="text" id="msgInput" placeholder="Escribe un mensaje aquí..." autofocus />
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const container = document.getElementById('chat-container');
                    const input = document.getElementById('msgInput');
                    const selector = document.getElementById('targetSelect');

                    window.addEventListener('message', event => {
                        const data = event.data;
                        
                        if (data.command === 'receive') {
                            const div = document.createElement('div');
                            div.className = 'msg';
                            if (data.senderId === data.myOpenId) div.classList.add('me');

                            let prefix = '';
                            let nameTag = '';

                            if (data.isPrivate) {
                                prefix = '<span class="private-badge">🔒 PRIVADO</span>';
                            }

                            if (data.role === 'teacher') {
                                nameTag = \`<span class="tag-profe">\${data.senderId === data.myOpenId ? 'Tú (Profe)' : data.sender}:</span>\`;
                            } else {
                                // Alumnos tienen comportamiento clicable para el Profe
                                nameTag = \`<span class="tag-alumno" data-id="\${data.senderId}" data-name="\${data.sender}">\${data.senderId === data.myOpenId ? 'Tú' : data.sender}:</span>\`;
                            }

                            div.innerHTML = \`<span class="timestamp">[\${data.timestamp}]</span>\${prefix}\${nameTag} \${data.message}\`;
                            container.appendChild(div);
                            container.scrollTop = container.scrollHeight;

                            // Asignar evento clic a los nombres de alumnos
                            if(${this._isTeacher}) {
                                div.querySelector('.tag-alumno')?.addEventListener('click', (e) => {
                                    const sId = e.target.getAttribute('data-id');
                                    if(sId && selector) {
                                        selector.value = sId;
                                        input.placeholder = "🔒 Mensaje privado...";
                                        input.focus();
                                    }
                                });
                            }
                        }

                        if (data.command === 'updateStudents' && selector) {
                            const currentSel = selector.value;
                            selector.innerHTML = '<option value="">📢 Enviar a: TODA LA CLASE</option>';
                            data.students.forEach(s => {
                                const opt = document.createElement('option');
                                opt.value = s.id;
                                opt.innerText = "🔒 Privado: " + s.name;
                                if(s.id === currentSel) opt.selected = true;
                                selector.appendChild(opt);
                            });
                        }
                    });

                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && input.value.trim()) {
                            const targetId = selector ? selector.value : undefined;
                            vscode.postMessage({ 
                                command: 'send', 
                                text: input.value,
                                targetId: targetId
                            });
                            input.value = '';
                        }
                    });

                    if(selector) {
                        selector.addEventListener('change', () => {
                            input.placeholder = selector.value ? "🔒 Mensaje privado..." : "Escribe un mensaje aquí...";
                            input.focus();
                        });
                    }
                </script>
            </body>
            </html>`;
  }

  public dispose() {
    CodeSyncChatPanel.currentPanel = undefined;
    this._panel.dispose();
  }
}
