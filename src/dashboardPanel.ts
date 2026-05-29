import * as vscode from 'vscode';

/**
 * Panel de control táctico (Dashboard) para el docente.
 * Renderiza en tiempo real el WPM, estado de enfoque, solicitudes de ayuda, alertas de plagio y capturas de monitor.
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
      'codesyncDashboard',
      '📊 CODESYNC :: MONITOR_SALA',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    CodeSyncDashboard.currentPanel = new CodeSyncDashboard(panel);

    panel.webview.postMessage({ command: 'trigger-initial-sync' });
  }

  /**
   * Procesa la telemetría entrante del socket y refresca la UI de la cuadrícula.
   */
  public updateTelemetry(data: any) {
    // CASO A: Gestión inteligente de desconexiones
    if (data.disconnected || (data.role === 'student-web' && data.socketId)) {
      const targetName = data.studentName;

      if (data.role === 'student-web' && targetName) {
        for (const [id, student] of this._studentsData.entries()) {
          if (student.name === targetName) {
            this._studentsData.set(id, { ...student, screenLinked: false });
            break;
          }
        }
      } else {
        const idToRemove = data.socketId || data.studentId;
        if (idToRemove) this._studentsData.delete(idToRemove);
      }

      this._render();
      return;
    }

    // CASO B: Vinculación o recarga desde la PÁGINA WEB del alumno
    if (data.studentName && !data.studentId) {
      let enlazado = false;

      for (const [id, student] of this._studentsData.entries()) {
        if (student.name === data.studentName) {
          this._studentsData.set(id, { ...student, screenLinked: true });
          enlazado = true;
          break;
        }
      }

      if (!enlazado) {
        const virtualId = `web-${data.studentName.replace(/\s+/g, '-').toLowerCase()}`;
        this._studentsData.set(virtualId, {
          studentId: virtualId,
          name: data.studentName,
          screenLinked: true,
          wpm: 0,
          isFocused: true,
          isAskingHelp: false,
          isCopyPaste: false,
          activeFilePath: '',
          ultimoCodigoPicado: '',
        });
      }
    }
    // CASO C: Telemetría pura desde la extensión de VS Code
    else {
      if (data.role === 'student-web' || (!data.studentId && !data.id)) return;

      const id = data.studentId || data.id;

      const virtualId = `web-${data.name ? data.name.replace(/\s+/g, '-').toLowerCase() : ''}`;
      let cachedWebLinked = false;
      if (this._studentsData.has(virtualId)) {
        cachedWebLinked = this._studentsData.get(virtualId).screenLinked;
        this._studentsData.delete(virtualId);
      }

      const prevData = this._studentsData.get(id) || {};
      const finalName = data.name && data.name !== 'Estudiante' ? data.name : prevData.name || 'Alumno Activo';

      this._studentsData.set(id, {
        ...prevData,
        ...data,
        studentId: id,
        name: finalName,
        screenLinked: data.screenLinked !== undefined ? data.screenLinked : prevData.screenLinked || cachedWebLinked,
      });
    }

    this._render();
  }

  private _render() {
    this._panel.webview.postMessage({
      command: 'render',
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
                        user-select: none; box-sizing: border-box; margin: 0;
                    }
                    .dashboard-container { padding: 20px; }
                    h2 { border-bottom: 2px solid #1a1a24; padding-bottom: 10px; margin-top: 0; margin-bottom: 25px; letter-spacing: 1px; }
                    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
                    
                    .card { 
                        background: #0f0f15; border: 1px solid #00ffcc33; padding: 16px; 
                        border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); 
                        transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.2s ease, box-shadow 0.2s ease; 
                        cursor: pointer; position: relative; overflow: hidden;
                        display: flex; flex-direction: column; justify-content: space-between;
                        will-change: transform; /* Fuerza la aceleración gráfica por GPU en el Webview */
                    }
                    
                    .card:hover { 
                        transform: translateY(-4px); 
                        border-color: #00ffcc; 
                        box-shadow: 0 6px 20px rgba(0, 255, 204, 0.15); 
                    }
                    
                    .card.unfocused { border-color: #ffaa0055; background: #120f0a; }
                    .card.unfocused:hover { border-color: #ffaa00; box-shadow: 0 6px 20px rgba(255, 170, 0, 0.15); }
                    
                    .card.asking-help { border-color: #ff008088; background: #160810; }
                    .card.asking-help:hover { border-color: #ff0080; box-shadow: 0 6px 20px rgba(255, 0, 128, 0.2); }
                    
                    .card.plagiarism-alert { border-color: #ff0033; background: #20050b; animation: pulse-border 1.5s infinite; }
                    
                    .name { font-size: 1.15em; font-weight: bold; margin-bottom: 10px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .metrics { display: flex; flex-direction: column; gap: 6px; font-size: 0.9em; margin-bottom: 12px; }
                    .metric-line { display: flex; justify-content: space-between; border-bottom: 1px dashed #1a1a24; padding-bottom: 2px; align-items: center; }
                    .metric-val { font-weight: bold; }
                    
                    .badge { padding: 3px 6px; font-size: 0.75em; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block; }
                    .badge.online { background: #00ffcc15; color: #00ffcc; border: 1px solid #00ffcc44; }
                    .badge.away { background: #ffaa0015; color: #ffaa00; border: 1px solid #ffaa0044; }
                    .badge.alert { background: #ff008015; color: #ff0080; border: 1px solid #ff008044; }
                    .badge.danger { background: #ff003322; color: #ff0033; border: 1px solid #ff0033aa; font-size: 0.7em; animation: blink 1s infinite; }
                    
                    .badge.web-linked { background: rgba(0, 255, 204, 0.1); color: #00ffcc; border: 1px solid #00ffcc88; }
                    .badge.web-unlinked { background: rgba(138, 138, 157, 0.1); color: #8a8a9d; border: 1px solid #8a8a9d44; }

                    .card-actions { margin-top: 10px; }
                    
                    .btn-capturar {
                        width: 100%; padding: 8px; background: transparent;
                        border: 1px solid #00ffcc; color: #00ffcc;
                        font-family: 'Courier New', monospace; font-weight: bold;
                        border-radius: 4px; cursor: pointer; 
                        transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
                    }

                    .btn-capturar:hover:not(:disabled) {
                        background: #00ffcc; color: #000000; box-shadow: 0 0 12px rgba(0, 255, 204, 0.6);
                    }

                    .modal-cyber {
                        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(5, 5, 10, 0.85); backdrop-filter: blur(8px);
                        display: flex; align-items: center; justify-content: center;
                        z-index: 9999; transition: all 0.3s ease;
                    }
                    .modal-contenido {
                        background: #111122; border: 2px solid #ff0080;
                        box-shadow: 0 0 30px rgba(255, 0, 128, 0.3);
                        border-radius: 8px; width: 85%; max-width: 950px; overflow: hidden;
                    }
                    .modal-cabecera {
                        background: #16162a; padding: 15px;
                        display: flex; justify-content: space-between; align-items: center;
                        border-bottom: 1px solid #2e2e4a; font-weight: bold; color: #00ffcc;
                    }
                    .btn-cerrar {
                        background: transparent; border: 1px solid #ff0080; color: #ff0080;
                        padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: bold;
                        font-family: 'Courier New', monospace;
                    }
                    .btn-cerrar:hover { background: #ff0080; color: #ffffff; box-shadow: 0 0 10px #ff0080; }
                    .modal-cuerpo { padding: 12px; display: flex; justify-content: center; background: #07070d; box-sizing: border-box; }
                    .modal-cuerpo img { width: 100%; height: auto; max-height: 75vh; border-radius: 4px; border: 1px solid #1a1a2e; object-fit: contain; }
                    .modal-cyber.oculto-modal { display: none !important; }
                    
                    @keyframes pulse-border {
                        0% { box-shadow: 0 0 4px #ff003322; }
                        50% { box-shadow: 0 0 15px #ff003355; border-color: #ff0033; }
                        100% { box-shadow: 0 0 4px #ff003322; }
                    }
                    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                </style>
            </head>
            <body>
                <div class="dashboard-container">
                    <h2>📟 PANEL DE CONTROL CENTRAL // TELEMETRÍA_DE_AULA_ACTIVA</h2>
                    <div class="grid" id="grid"></div>
                </div>

                <div id="modal-visor" class="modal-cyber oculto-modal">
                    <div class="modal-contenido">
                        <div class="modal-cabecera">
                            <span id="modal-titulo">PANTALLA EN VIVO: Cargando...</span>
                            <button class="btn-cerrar" onclick="cerrarModal()">✕ CERRAR</button>
                        </div>
                        <div class="modal-cuerpo">
                            <img id="modal-imagen" src="" alt="Captura remota">
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const grid = document.getElementById('grid');
                    
                    window.addEventListener('message', event => {
                        const message = event.data;

                        if (message.command === 'screenshot-received') {
                            const blobLocal = new Blob([message.imageArray], { type: 'image/jpeg' });
                            const urlObjeto = URL.createObjectURL(blobLocal);
                            
                            document.getElementById('modal-titulo').innerText = '💻 VISOR EN TIEMPO REAL // MONITOREO: ' + message.studentName.toUpperCase();
                            
                            const mapaImagen = document.getElementById('modal-imagen');
                            const urlVieja = mapaImagen.src;
                            
                            mapaImagen.src = urlObjeto;
                            
                            if (urlVieja && urlVieja.startsWith('blob:')) {
                                URL.revokeObjectURL(urlVieja);
                            }
                            
                            document.getElementById('modal-visor').classList.remove('oculto-modal');
                            return;
                        }

                        if (message.command === 'render') {
                            grid.innerHTML = '';
                            
                            message.students.forEach(s => {
                                const card = document.createElement('div');
                                card.className = 'card';
                                card.setAttribute('data-id', s.studentId);
                                
                                let statusBadge = '<span class="badge online">ACTIVO</span>';
                                if (!s.isFocused) {
                                    card.className += ' unfocused';
                                    statusBadge = '<span class="badge away">FUERA_VS</span>';
                                }
                                if (s.isAskingHelp) {
                                    card.className += ' asking-help';
                                    statusBadge = '<span class="badge alert">🙋‍♂️ AYUDA</span>';
                                }
                                if (s.isCopyPaste) {
                                    card.className = 'card plagiarism-alert';
                                    statusBadge = '<span class="badge danger">⚠️ COPY_PASTE</span>';
                                }

                                const badgeWeb = s.screenLinked 
                                    ? '<span class="badge web-linked">🖥️ ENLAZADO</span>' 
                                    : '<span class="badge web-unlinked">❌ SIN WEB</span>';

                                const botonCaptura = s.screenLinked
                                    ? '<button class="btn-capturar">📸 CAPTURAR MONITOR</button>'
                                    : '<button class="btn-capturar" style="opacity: 0.3; cursor: not-allowed; border-color: #444; color: #666;" disabled>PANTALLA DESCONECTADA</button>';

                                const currentWpm = s.wpm !== undefined ? s.wpm : 0;
                                let wpmColor = '#00ffcc';
                                if (currentWpm > 150) wpmColor = '#ff0033';
                                if (currentWpm === 0) wpmColor = '#555577';

                                const rawPath = s.activeFilePath || '';
                                const fileName = (rawPath && rawPath.includes('/')) ? rawPath.split('/').pop() : (rawPath || 'Ninguno');

                                card.innerHTML = \`
                                    <div>
                                        <div class="name" title="\${s.name}">\${s.name}</div>
                                        <div class="metrics">
                                            <div class="metric-line">
                                                <span>Rendimiento:</span>
                                                <span style="color: \${wpmColor}" class="metric-val">\${currentWpm} WPM</span>
                                            </div>
                                            <div class="metric-line">
                                                <span>Editando:</span>
                                                <span style="color: #deff9a; font-size: 0.85em;" class="metric-val">\${fileName}</span>
                                            </div>
                                            <div class="metric-line">
                                                <span>Estado Red:</span>
                                                <span class="metric-val">\${statusBadge}</span>
                                            </div>
                                            <div class="metric-line">
                                                <span>Enlace Web:</span>
                                                <span class="metric-val">\${badgeWeb}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-actions">
                                        \${botonCaptura}
                                        <div style="font-size: 0.7em; color: #333; text-align: right; margin-top: 8px;">NODO_ID: \${s.studentId.substring(0,6)}</div>
                                    </div>
                                \`;
                                
                                const btn = card.querySelector('.btn-capturar');
                                if (btn && s.screenLinked) {
                                    btn.addEventListener('click', (event) => {
                                        event.stopPropagation();
                                        vscode.postMessage({
                                            command: 'requestScreenshot',
                                            studentName: s.name
                                        });
                                    });
                                }

                                card.addEventListener('click', () => {
                                    if(s.studentId.startsWith('web-')) return;
                                    
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

                    function cerrarModal() {
                        document.getElementById('modal-visor').classList.add('oculto-modal');
                        const mapaImagen = document.getElementById('modal-imagen');
                        if (mapaImagen.src.startsWith('blob:')) {
                            URL.revokeObjectURL(mapaImagen.src);
                        }
                        mapaImagen.src = '';
                    }

                    window.onload = () => {
                        vscode.postMessage({
                            command: 'requestDashboardSync'
                        });
                    };
                </script>
            </body>
            </html>`;
  }
}
