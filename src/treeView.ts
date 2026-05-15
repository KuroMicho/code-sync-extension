import * as vscode from "vscode";

/**
 * Proveedor de datos para la vista lateral de "CodeSync: Classroom".
 * Maneja la jerarquía: Estudiante -> Archivos.
 */
export class StudentDataProvider implements vscode.TreeDataProvider<StudentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    StudentTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Mapa persistente: socketId -> { nombre, lista_de_archivos }
  private students = new Map<string, { name: string; files: string[] }>();
  // Set para rastrear quién ha solicitado asistencia
  private studentsHelpStatus = new Set<string>();

  /**
   * Cambia el estado de ayuda de un alumno y refresca la vista.
   */
  public setHelpStatus(studentId: string, status: boolean) {
    if (status) {
      this.studentsHelpStatus.add(studentId);
    } else {
      this.studentsHelpStatus.delete(studentId);
    }
    this._onDidChangeTreeData.fire();
  }

  public refresh(studentId: string, name: string, files: string[]): void {
    this.students.set(studentId, { name, files });
    this._onDidChangeTreeData.fire();
  }

  public clearAll(): void {
    this.students.clear();
    this.studentsHelpStatus.clear();
    this._onDidChangeTreeData.fire();
    console.log("[CodeSync TreeView]: Vista y estados de ayuda reseteados.");
  }

  public removeStudent(studentId: string): void {
    if (this.students.has(studentId)) {
      this.students.delete(studentId);
      this.studentsHelpStatus.delete(studentId); // Limpiamos también su estado de ayuda
      this._onDidChangeTreeData.fire();
    }
  }

  public getTreeItem(element: StudentTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: StudentTreeItem): Thenable<StudentTreeItem[]> {
    if (!element) {
      // NIVEL RAÍZ: Lista de Estudiantes
      const studentItems = Array.from(this.students.entries()).map(
        ([id, data]) => {
          // CORRECCIÓN: La verificación de ayuda debe ir dentro del mapeo
          const isAskingHelp = this.studentsHelpStatus.has(id);

          return new StudentTreeItem(
            data.name,
            id,
            vscode.TreeItemCollapsibleState.Collapsed,
            true,
            undefined,
            isAskingHelp,
          );
        },
      );

      // Ordenar estudiantes alfabéticamente
      return Promise.resolve(
        studentItems.sort((a, b) =>
          (a.label as string).localeCompare(b.label as string),
        ),
      );
    } else if (element.isStudent) {
      // NIVEL HIJOS: Archivos del estudiante seleccionado
      const student = this.students.get(element.studentId!);
      if (!student) return Promise.resolve([]);

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
 * Representa un ítem (Alumno o Archivo) en el explorador de CodeSync.
 */
export class StudentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly studentId: string | undefined,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isStudent: boolean,
    public readonly filePath?: string,
    public readonly isAskingHelp: boolean = false,
  ) {
    super(label, collapsibleState);

    // ID único para mantener el estado del scroll/colapso
    this.id = isStudent ? studentId : `${studentId}-${filePath}`;

    if (isStudent) {
      this.tooltip = `Estudiante: ${label}\nSocket ID: ${studentId}`;

      // Estética de Ayuda: Cambiamos icono y descripción si levantó la mano
      this.iconPath = new vscode.ThemeIcon(
        isAskingHelp ? "question" : "account",
        isAskingHelp ? new vscode.ThemeColor("charts.red") : undefined,
      );

      this.description = isAskingHelp ? "¡NECESITA AYUDA!" : "En línea";

      // El contextValue permite mostrar menús diferentes (Ej: botón de "Resuelto")
      this.contextValue = isAskingHelp ? "student-help" : "student";
    } else {
      const isImage = /\.(jpg|jpeg|png|gif|ico|svg)$/i.test(label);
      this.iconPath = new vscode.ThemeIcon(
        isImage ? "file-media" : "file-code",
      );

      this.contextValue = "file";
      this.description = "";
      this.tooltip = `Ver código de: ${label}`;

      this.command = {
        command: "code-sync.openStudentFile",
        title: "Abrir Archivo Virtual",
        arguments: [this.studentId, this.filePath],
      };
    }
  }
}
