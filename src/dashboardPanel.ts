import * as vscode from "vscode";

/**
 * Panel de control táctico (Dashboard) para el docente.
 * Renderiza en tiempo real el WPM, estado de enfoque, solicitudes de ayuda y alertas de plagio.
 */
export class CodeSyncDashboard {
  public static currentPanel: CodeSyncDashboard | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _studentsData = new Map<string, any>();

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => {
      CodeSyncDashboard.currentPanel = undefined;
    });
    this._panel.webview.html = this._getHtml();
  }

  public static createOrShow() {
    if (CodeSyncDashboard.currentPanel) {
      CodeSyncDashboard.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "codesyncDashboard",
      "📊 CODESYNC :: MONITOR_SALA",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    CodeSyncDashboard.currentPanel = new CodeSyncDashboard(panel);
  }

  /**
   * Procesa la telemetría entrante del socket y refresca la UI de la cuadrícula.
   */
  public updateTelemetry(data: any) {
    if (!data.studentId) return;

    // Si el socket reporta que el usuario se desconectó, lo removemos del mapa
    if (data.disconnected) {
      this._studentsData.delete(data.studentId);
    } else {
      // Combinamos el estado previo con las nuevas métricas (WPM, Enfoque, etc.)
      this._studentsData.set(data.studentId, {
        ...this._studentsData.get(data.studentId),
        ...data,
      });
    }

    this._panel.webview.postMessage({
      command: "render",
      students: Array.from(this._studentsData.values()),
    });
  }

  private _getHtml() {
    return `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { 
                        background: #08080c; color: #00ffcc; 
                        font-family: 'Courier New', monospace; padding: 20px; 
                        user-select: none; box-sizing: border-box;
                    }
                    h2 { border-bottom: 2px solid #1a1a24; padding-bottom: 10px; margin-bottom: 25px; letter-spacing: 1px; }
                    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
                    
                    /* Tarjeta Base Estilo Cyberpunk */
                    .card { 
                        background: #0f0f15; border: 1px solid #00ffcc33; padding: 16px; 
                        border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); 
                        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;
                        position: relative; overflow: hidden;
                    }
                    .card:hover { 
                        transform: translateY(-4px); border-color: #00ffcc; 
                        box-shadow: 0 0 15px rgba(0, 255, 204, 0.2); 
                    }
                    
                    /* Estados Dinámicos */
                    .card.unfocused { border-color: #ffaa0055; background: #120f0a; }
                    .card.unfocused:hover { border-color: #ffaa00; box-shadow: 0 0 15px rgba(255, 170, 0, 0.2); }
                    
                    .card.asking-help { border-color: #ff008088; background: #160810; }
                    .card.asking-help:hover { border-color: #ff0080; box-shadow: 0 0 15px rgba(255, 0, 128, 0.3); }
                    
                    .card.plagiarism-alert { border-color: #ff0033; background: #20050b; animation: pulse-border 1.5s infinite; }
                    
                    /* Tipografías e Indicadores */
                    .name { font-size: 1.15em; font-weight: bold; margin-bottom: 10px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .metrics { display: flex; flex-direction: column; gap: 6px; font-size: 0.9em; margin-bottom: 12px; }
                    .metric-line { display: flex; justify-content: space-between; border-bottom: 1px dashed #1a1a24; padding-bottom: 2px; }
                    .metric-val { font-weight: bold; }
                    
                    /* Badges Neón */
                    .badge { padding: 3px 6px; font-size: 0.75em; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
                    .badge.online { background: #00ffcc15; color: #00ffcc; border: 1px solid #00ffcc44; }
                    .badge.away { background: #ffaa0015; color: #ffaa00; border: 1px solid #ffaa0044; }
                    .badge.alert { background: #ff008015; color: #ff0080; border: 1px solid #ff008044; }
                    .badge.danger { background: #ff003322; color: #ff0033; border: 1px solid #ff0033aa; font-size: 0.7em; animation: blink 1s infinite; }
                    
                    @keyframes pulse-border {
                        0% { box-shadow: 0 0 4px #ff003322; }
                        50% { box-shadow: 0 0 15px #ff003355; border-color: #ff0033; }
                        100% { box-shadow: 0 0 4px #ff003322; }
                    }
                    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                </style>
            </head>
            <body>
                <h2>📟 PANEL DE CONTROL CENTRAL // TELEMETRÍA_DE_AULA_ACTIVA</h2>
                <div class="grid" id="grid"></div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const grid = document.getElementById('grid');
                    
                    window.addEventListener('message', event => {
                        if (event.data.command === 'render') {
                            grid.innerHTML = '';
                            
                            event.data.students.forEach(s => {
                                const card = document.createElement('div');
                                card.className = 'card';
                                
                                // Asignamos identificadores para recuperar la acción al hacer clic
                                card.setAttribute('data-id', s.studentId);
                                
                                // Resolviendo estados y prioridades de visualización
                                let statusBadge = '<span class="badge online">ACTIVO</span>';
                                if (!s.isFocused) {
                                    card.classList.add('unfocused');
                                    statusBadge = '<span class="badge away">FUERA_VS</span>';
                                }
                                if (s.isAskingHelp) {
                                    card.classList.add('asking-help');
                                    statusBadge = '<span class="badge alert">🙋‍♂️ AYUDA</span>';
                                }
                                if (s.isCopyPaste) {
                                    card.classList.remove('unfocused', 'asking-help');
                                    card.classList.add('plagiarism-alert');
                                    statusBadge = '<span class="badge danger">⚠️ COPY_PASTE</span>';
                                }

                                // Renderizado de valores con salvaguardas por si no ha iniciado el tracker
                                const currentWpm = s.wpm !== undefined ? s.wpm : 0;
                                const wpmColor = currentWpm > 150 ? '#ff0033' : (currentWpm === 0 ? '#555577' : '#00ffcc');

                                card.innerHTML = \`
                                    <div class="name" title="\${s.name}">\${s.name}</div>
                                    <div class="metrics">
                                        <div class="metric-line">
                                            <span>Rendimiento:</span>
                                            <span style="color: \${wpmColor}" class="metric-val">\${currentWpm} WPM</span>
                                        </div>
                                        <div class="metric-line">
                                            <span>Editando:</span>
                                            <span style="color: #deff9a; font-size: 0.85em;" class="metric-val">\${s.activeFilePath ? s.activeFilePath.split('/').pop() : 'Ninguno'}</span>
                                        </div>
                                        <div class="metric-line">
                                            <span>Estado Red:</span>
                                            <span class="metric-val">\${statusBadge}</span>
                                        </div>
                                    </div>
                                    <div style="font-size: 0.75em; color: #444; text-align: right;">NODO_ID: \${s.studentId.substring(0,6)}</div>
                                \`;
                                
                                // Evento táctico: Al hacer clic, le dice a extension.ts que abra el archivo de este alumno
                                card.addEventListener('click', () => {
                                vscode.postMessage({
                                    command: 'openStudent',
                                    studentId: s.studentId,
                                    filePath: s.activeFilePath || "index.html"
                                    });
                                });
                                
                                grid.appendChild(card);
                            });
                        }
                    });
                </script>
            </body>
            </html>`;
  }
}
