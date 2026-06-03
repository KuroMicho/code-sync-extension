import * as vscode from 'vscode';
import { SocketManager } from './socket';

/**
 * Proveedor de Contenido para Documentos Virtuales.
 * Permite que VS Code abra archivos remotos bajo el esquema 'codesync://'
 */
export class CodeSyncProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'codesync';

  private readonly contentMap = new Map<string, string>();

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly socketManager: SocketManager) {}

  /**
   * Método nativo del núcleo de VS Code: Se dispara al abrir una pestaña virtual.
   */
  public provideTextDocumentContent(uri: vscode.Uri): string {
    const cachedContent = this.contentMap.get(uri.toString());

    if (cachedContent === undefined) {
      // console.log(`[CodeSync Provider]: Solicitando contenido inicial para: ${uri.path}`);

      this.requestInitialContent(uri);

      return [
        '// [CodeSync]: Sincronizando código desde la PC del estudiante...',
        '// La vista se actualizará automáticamente en segundos.',
        '// ----------------------------------------------------------------------',
        '// Nota: El alumno debe tener el archivo activo en su espacio de trabajo.',
      ].join('\n');
    }

    return cachedContent;
  }

  /**
   * Actualiza el buffer en memoria y notifica al editor para repintar los caracteres.
   */
  public updateContent(uri: vscode.Uri, content: string): void {
    this.contentMap.set(uri.toString(), content);
    this._onDidChange.fire(uri);
    // console.log(`[CodeSync Provider]: Contenido actualizado para: ${uri.path}`);
  }

  /**
   * LIMPIEZA DE MEMORIA: Purgado de referencias muertas asociadas a un estudiante desconectado.
   */
  public deleteStudentContent(studentId: string): void {
    let purgedCount = 0;
    const cacheKeys = Array.from(this.contentMap.keys());

    for (const key of cacheKeys) {
      try {
        const parsedUri = vscode.Uri.parse(key);
        if (parsedUri.authority === studentId) {
          this.contentMap.delete(key);
          purgedCount++;
        }
      } catch (error) {
        // Error silenciado
      }
    }
  }

  /**
   * RESET TOTAL: Vaciado absoluto de caché para evitar persistencia de estados fantasmas entre clases.
   */
  public clearAll(): void {
    this.contentMap.clear();
    // console.log('[CodeSync Provider]: Caché de archivos vaciado por cambio de sesión.');
  }

  /**
   * Solicita de forma asíncrona la inyección del buffer al socket del estudiante correspondiente.
   */
  private requestInitialContent(uri: vscode.Uri): void {
    const studentId = uri.authority;
    const normalizedFilePath = uri.path.replace(/^\/+/, '').trim();

    if (!studentId || !normalizedFilePath) {
      return;
    }

    this.socketManager.emit('request-file-content', {
      studentId,
      filePath: normalizedFilePath,
    });
  }

  /**
   * Helper estático para construir URIs bajo la nomenclatura estructurada: codesync://[socketId]/[ruta_relativa]
   */
  public static createUri(studentId: string, filePath: string): vscode.Uri {
    const sanitizedPath = filePath.replace(/\\/g, '/');
    const normalizedPath = sanitizedPath.startsWith('/') ? sanitizedPath : `/${sanitizedPath}`;

    return vscode.Uri.parse(`${CodeSyncProvider.scheme}://${studentId}${normalizedPath}`);
  }

  /**
   * Recupera el contenido síncrono en memoria (Requerido por los paneles de Vista Previa HTML).
   */
  public getContent(uriString: string): string | undefined {
    return this.contentMap.get(uriString);
  }
}
