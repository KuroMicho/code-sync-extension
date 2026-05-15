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
    // Verificamos si ya tenemos el contenido en caché
    const content = this.contentMap.get(uri.toString());

    if (content === undefined) {
      console.log(
        `[CodeSync Provider]: Solicitando contenido inicial para: ${uri.path}`,
      );

      // Pedimos el contenido al estudiante de forma asíncrona a través del socket
      this.requestInitialContent(uri);

      // Mensaje temporal que verá el profesor mientras llega la respuesta
      return [
        "// [CodeSync]: Sincronizando código desde la PC del estudiante...",
        "// La vista se actualizará automáticamente en segundos.",
        "// ----------------------------------------------------------------------",
        "// Nota: El alumno debe tener el archivo en su espacio de trabajo.",
      ].join("\n");
    }

    return content;
  }

  /**
   * Actualiza el contenido en memoria y fuerza el refresco visual en el editor.
   */
  public updateContent(uri: vscode.Uri, content: string) {
    this.contentMap.set(uri.toString(), content);

    // Notificamos a VS Code que el documento cambió para que vuelva a renderizar el texto
    this._onDidChange.fire(uri);

    console.log(`[CodeSync Provider]: Contenido actualizado para: ${uri.path}`);
  }

  /**
   * LIMPIEZA DE MEMORIA: Elimina todos los archivos guardados de un estudiante específico.
   * Se invoca cuando el alumno se desconecta.
   */
  public deleteStudentContent(studentId: string) {
    let count = 0;
    for (const [key, _] of this.contentMap) {
      try {
        const uri = vscode.Uri.parse(key);
        // Comparamos el authority (socketId) de forma precisa
        if (uri.authority === studentId) {
          this.contentMap.delete(key);
          count++;
        }
      } catch (e) {
        // En caso de claves malformadas, simplemente las saltamos
        continue;
      }
    }
    console.log(
      `[CodeSync Provider]: Limpieza de memoria: ${count} archivos eliminados de ${studentId}`,
    );
  }

  /**
   * RESET TOTAL: Limpia todo el caché de archivos almacenados.
   * Crucial para evitar "fantasmas" al cambiar de sala.
   */
  public clearAll() {
    this.contentMap.clear();
    console.log(
      "[CodeSync Provider]: Caché de archivos vaciado por cambio de sesión.",
    );
  }

  /**
   * Solicita el contenido inicial al socket del estudiante.
   */
  private requestInitialContent(uri: vscode.Uri) {
    const studentId = uri.authority;
    // Normalización: quitamos las barras iniciales de la ruta
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
    // Aseguramos que la ruta comience con una sola barra para el esquema de URI
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
