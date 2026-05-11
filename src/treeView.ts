import * as vscode from "vscode";

/**
 * Proveedor de datos que alimenta la vista lateral de "CodeSync: Classroom".
 * Maneja la jerarquía: Estudiante (Contenedor) > Archivos (Items).
 */
export class StudentDataProvider implements vscode.TreeDataProvider<StudentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    StudentTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Mapa persistente: socketId -> { nombre, lista_de_archivos }
  private students = new Map<string, { name: string; files: string[] }>();

  /**
   * Actualiza los datos de un estudiante y refresca la interfaz.
   */
  public refresh(studentId: string, name: string, files: string[]): void {
    this.students.set(studentId, { name, files });
    this._onDidChangeTreeData.fire();
  }

  /**
   * LIMPIEZA TOTAL: Borra todos los estudiantes y archivos de la vista.
   * Crucial para evitar que se mezclen datos al cambiar de sala.
   */
  public clearAll(): void {
    this.students.clear();
    this._onDidChangeTreeData.fire();
    console.log("[CodeSync TreeView]: Vista reseteada correctamente.");
  }

  /**
   * Elimina a un estudiante específico (ej: al desconectarse).
   */
  public removeStudent(studentId: string): void {
    if (this.students.has(studentId)) {
      this.students.delete(studentId);
      this._onDidChangeTreeData.fire();
    }
  }

  public getTreeItem(element: StudentTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Determina la estructura del árbol para VS Code.
   */
  public getChildren(element?: StudentTreeItem): Thenable<StudentTreeItem[]> {
    if (!element) {
      // NIVEL RAÍZ: Lista de Estudiantes
      const studentItems = Array.from(this.students.entries()).map(
        ([id, data]) =>
          new StudentTreeItem(
            data.name,
            id,
            vscode.TreeItemCollapsibleState.Collapsed,
            true,
          ),
      );

      // Ordenar estudiantes alfabéticamente
      return Promise.resolve(
        studentItems.sort((a, b) => a.label.localeCompare(b.label)),
      );
    } else if (element.isStudent) {
      // NIVEL HIJOS: Archivos del estudiante seleccionado
      const student = this.students.get(element.studentId!);
      if (!student) return Promise.resolve([]);

      // Ordenar archivos alfabéticamente para facilitar la navegación
      const sortedFiles = [...student.files].sort((a, b) => a.localeCompare(b));

      return Promise.resolve(
        sortedFiles.map(
          (file) =>
            new StudentTreeItem(
              file,
              element.studentId,
              vscode.TreeItemCollapsibleState.None,
              false,
              file,
            ),
        ),
      );
    }
    return Promise.resolve([]);
  }
}

/**
 * Clase que representa un ítem visual en el árbol (Estudiante o Archivo).
 */
export class StudentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly studentId: string | undefined,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isStudent: boolean,
    public readonly filePath?: string,
  ) {
    super(label, collapsibleState);

    // ID ÚNICO: Evita que VS Code colapse las ramas cuando el árbol se refresca.
    this.id = isStudent ? studentId : `${studentId}-${filePath}`;

    if (isStudent) {
      this.iconPath = new vscode.ThemeIcon("account");
      this.contextValue = "student"; // Define qué menús mostrar en package.json
      this.description = "En línea";
      this.tooltip = `Estudiante: ${label}\nSocket: ${studentId}`;
    } else {
      // Detección de binarios/imágenes para iconos visuales
      const isImage = /\.(jpg|jpeg|png|gif|ico|svg)$/i.test(label);
      this.iconPath = new vscode.ThemeIcon(
        isImage ? "file-media" : "file-code",
      );

      this.contextValue = "file";
      this.tooltip = `Ver código de: ${label}`;

      // Comando nativo para abrir el archivo virtual
      this.command = {
        command: "code-sync.openStudentFile",
        title: "Abrir Archivo",
        arguments: [this.studentId, this.filePath],
      };
    }
  }
}
