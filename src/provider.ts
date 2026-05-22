import * as vscode from 'vscode';
import { SocketManager } from './socket';

/**
 * Proveedor de Contenido para Documentos Virtuales.
 * Permite que VS Code abra archivos remotos bajo el esquema 'codesync://'
 */
export class CodeSyncProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'codesync';

  // Almacen de contenido mapeado en memoria: URI String -> Codigo de fuente
  private readonly contentMap = new Map<string, string>();

  // Emisor de eventos reactivo para forzar el redibujado de buffers de texto
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly socketManager: SocketManager) {}

  /**
   * Metodo nativo del nucleo de VS Code: Se dispara al abrir una pestaña virtual.
   */
  public provideTextDocumentContent(uri: vscode.Uri): string {
    const cachedContent = this.contentMap.get(uri.toString());

    if (cachedContent === undefined) {
      console.log(`[CodeSync Provider]: Solicitando contenido inicial para: ${uri.path}`);

      this.requestInitialContent(uri);

      // Buffer de texto temporal visible durante la negociacion de red P2P
      return [
        '// [CodeSync]: Sincronizando codigo desde la PC del estudiante...',
        '// La vista se actualizara automaticamente en segundos.',
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
    console.log(`[CodeSync Provider]: Contenido actualizado para: ${uri.path}`);
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
        console.error(`[CodeSync Provider]: Error al parsear URI del cache durante purga: ${key}`);
      }
    }
    console.log(
      `[CodeSync Provider]: Limpieza de memoria completada: ${purgedCount} archivos eliminados de ${studentId}`,
    );
  }

  /**
   * RESET TOTAL: Vaciado absoluto de cache para evitar persistencia de estados fantasmas entre clases.
   */
  public clearAll(): void {
    this.contentMap.clear();
    console.log('[CodeSync Provider]: Cache de archivos vaciado por cambio de sesion.');
  }

  /**
   * Solicita de forma asincrona la inyeccion del buffer al socket del estudiante correspondiente.
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
   * Helper estatico para construir URIs bajo la nomenclatura estructurada: codesync://[socketId]/[ruta_relativa]
   */
  public static createUri(studentId: string, filePath: string): vscode.Uri {
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return vscode.Uri.parse(`${CodeSyncProvider.scheme}://${studentId}${normalizedPath}`);
  }

  /**
   * Recupera el contenido sincrono en memoria (Requerido por los paneles de Vista Previa HTML).
   */
  public getContent(uriString: string): string | undefined {
    return this.contentMap.get(uriString);
  }
}
