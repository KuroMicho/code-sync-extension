import * as vscode from "vscode";
import { SocketManager } from "./socket";

/**
 * Proveedor de Contenido para Documentos Virtuales.
 * Permite que VS Code abra archivos con el esquema 'codesync://'
 */
export class CodeSyncProvider implements vscode.TextDocumentContentProvider {
  static scheme = "codesync";

  // Almacén de contenido: URI String -> Contenido del archivo
  private contentMap = new Map<string, string>();

  // Emisor de eventos para notificar a VS Code que un documento cambió
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private socketManager: SocketManager) {}

  /**
   * Método principal de VS Code: Se dispara cuando el profe abre una pestaña 'codesync://'
   */
  public provideTextDocumentContent(uri: vscode.Uri): string {
    const content = this.contentMap.get(uri.toString());

    if (content === undefined) {
      console.log(
        `[CodeSync Provider]: Solicitando contenido inicial para: ${uri.path}`,
      );

      // Pedimos el contenido al estudiante de forma asíncrona
      this.requestInitialContent(uri);

      // Mensaje elegante de carga en el editor
      return [
        "// [CodeSync]: Sincronizando código desde la PC del estudiante...",
        "// La vista se actualizará automáticamente en cuanto el alumno responda.",
        ,
      ].join("\n");
    }

    return content;
  }

  /**
   * Actualiza el contenido en memoria y fuerza el refresco visual.
   */
  public updateContent(uri: vscode.Uri, content: string) {
    this.contentMap.set(uri.toString(), content);

    // Notificamos a VS Code que el documento cambió para que vuelva a renderizar
    this._onDidChange.fire(uri);

    console.log(`[CodeSync Provider]: Editor actualizado -> ${uri.path}`);
  }

  /**
   * LIMPIEZA DE MEMORIA: Elimina todos los archivos guardados de un estudiante.
   * Se debe llamar desde socket.ts cuando un alumno se desconecta.
   */
  public deleteStudentContent(studentId: string) {
    let count = 0;
    for (const key of this.contentMap.keys()) {
      if (key.includes(`://${studentId}/`)) {
        this.contentMap.delete(key);
        count++;
      }
    }
    console.log(
      `[CodeSync Provider]: Limpieza de memoria: ${count} archivos eliminados de ${studentId}`,
    );
  }

  /**
   * Solicita el contenido inicial al socket del estudiante.
   */
  private requestInitialContent(uri: vscode.Uri) {
    const studentId = uri.authority;

    // Normalización de ruta: removemos la barra inicial y espacios
    const filePath = uri.path.replace(/^\/+/, "").trim();

    if (!studentId || !filePath) return;

    this.socketManager.emit("request-file-content", {
      studentId,
      filePath,
    });
  }

  /**
   * Helper estático para generar URIs consistentes: codesync://[socketId]/[ruta]
   */
  public static createUri(studentId: string, filePath: string): vscode.Uri {
    // Aseguramos que la ruta comience con una sola barra
    const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;

    return vscode.Uri.parse(
      `${CodeSyncProvider.scheme}://${studentId}${normalizedPath}`,
    );
  }

  /**
   * Obtiene el contenido actual (usado por la Vista Previa HTML).
   */
  public getContent(uriString: string): string | undefined {
    return this.contentMap.get(uriString);
  }
}
