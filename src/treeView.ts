import * as vscode from 'vscode';

interface IStudentNode {
  name: string;
  files: string[];
}

/**
 * Proveedor de datos para la vista lateral de "CodeSync: Classroom".
 * Maneja la jerarquía estructural y reactiva: Estudiante -> Archivos del Espacio de Trabajo.
 */
export class StudentDataProvider implements vscode.TreeDataProvider<StudentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StudentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly students = new Map<string, IStudentNode>();

  private readonly studentsHelpStatus = new Set<string>();
  private readonly studentsPlagiarismStatus = new Set<string>();

  /**
   * Modifica el estado de asistencia de un alumno y fuerza el refresco del árbol lateral.
   */
  public setHelpStatus(studentId: string, status: boolean): void {
    if (status) {
      this.studentsHelpStatus.add(studentId);
    } else {
      this.studentsHelpStatus.delete(studentId);
    }
    this._onDidChangeTreeData.fire();
  }

  /**
   * Modifica el estado de alerta por Copy-Paste masivo de un alumno y fuerza el refresco inmediato.
   */
  public setPlagiarismStatus(studentId: string, status: boolean): void {
    if (status) {
      this.studentsPlagiarismStatus.add(studentId);
    } else {
      this.studentsPlagiarismStatus.delete(studentId);
    }
    this._onDidChangeTreeData.fire();
  }

  /**
   * Inserta o actualiza el árbol de archivos reportado por el cliente de un estudiante.
   */
  public refresh(studentId: string, name: string, files: string[]): void {
    const sanitizedFiles = files.map((file) => file.replace(/\\/g, '/'));
    this.students.set(studentId, { name, files: sanitizedFiles });
    this._onDidChangeTreeData.fire();
  }

  /**
   * Resetea por completo los buffers de datos y estados de soporte al cambiar de sala.
   */
  public clearAll(): void {
    this.students.clear();
    this.studentsHelpStatus.clear();
    this.studentsPlagiarismStatus.clear();
    this._onDidChangeTreeData.fire();
    console.log('[CodeSync TreeView]: Todos los nodos y estados de telemetría reseteados.');
  }

  /**
   * Remueve a un alumno del árbol lateral al desconectarse para evitar referencias muertas.
   */
  public removeStudent(studentId: string): void {
    if (this.students.has(studentId)) {
      this.students.delete(studentId);
      this.studentsHelpStatus.delete(studentId);
      this.studentsPlagiarismStatus.delete(studentId);
      this._onDidChangeTreeData.fire();
    }
  }

  public getTreeItem(element: StudentTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: StudentTreeItem): Thenable<StudentTreeItem[]> {
    if (!element) {
      // --- NIVEL RAÍZ: Mapeo, extracción de analíticas y ordenamiento de Alumnos ---
      const studentItems = Array.from(this.students.entries()).map(([id, data]) => {
        const isAskingHelp = this.studentsHelpStatus.has(id);
        const isPlagiarized = this.studentsPlagiarismStatus.has(id);

        return new StudentTreeItem(
          data.name,
          id,
          vscode.TreeItemCollapsibleState.Collapsed,
          true,
          undefined,
          isAskingHelp,
          isPlagiarized,
        );
      });

      // Ordenamiento alfabético automático para una navegación fluida del docente
      return Promise.resolve(studentItems.sort((a, b) => (a.label as string).localeCompare(b.label as string)));
    }

    if (element.isStudent) {
      // --- NIVEL HIJOS: Renderizado de los archivos virtuales del alumno seleccionado ---
      const student = this.students.get(element.studentId!);
      if (!student) return Promise.resolve([]);

      const sortedFiles = [...student.files].sort((a, b) => a.localeCompare(b));

      return Promise.resolve(
        sortedFiles.map(
          (file) => new StudentTreeItem(file, element.studentId, vscode.TreeItemCollapsibleState.None, false, file),
        ),
      );
    }

    return Promise.resolve([]);
  }
}

/**
 * Representa un nodo gráfico (Estudiante o Fichero Virtual) dentro de la barra lateral de VS Code.
 */
export class StudentTreeItem extends vscode.TreeItem {
  constructor(
    public override readonly label: string,
    public readonly studentId: string | undefined,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isStudent: boolean,
    public readonly filePath?: string,
    public readonly isAskingHelp: boolean = false,
    public readonly isPlagiarized: boolean = false,
  ) {
    super(label, collapsibleState);

    this.id = isStudent ? studentId : `${studentId}-${filePath}`;

    if (isStudent) {
      this.tooltip = `Estudiante: ${label}\nSocket ID: ${studentId}`;
      this.configureStudentNode();
    } else {
      this.configureFileNode();
    }
  }

  /**
   * Aplica la identidad visual, descripciones técnicas y estados de alerta para el nodo Alumno.
   */
  private configureStudentNode(): void {
    if (this.isPlagiarized) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
      this.description = 'ALERTA: COPY-PASTE DETECTADO';
      this.contextValue = 'student-alert';
    } else if (this.isAskingHelp) {
      this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.orange'));
      this.description = 'SOLICITA ASISTENCIA';
      this.contextValue = 'student-help';
    } else {
      this.iconPath = new vscode.ThemeIcon('account');
      this.description = 'En línea';
      this.contextValue = 'student';
    }
  }

  /**
   * Aplica la iconografía, comandos de apertura P2P y tooltips para los nodos hoja (Archivos).
   */
  private configureFileNode(): void {
    const isImage = /\.(jpg|jpeg|png|gif|ico|svg)$/i.test(this.label);
    const isHtml = /\.html?$/i.test(this.label);
    this.iconPath = new vscode.ThemeIcon(isImage ? 'file-media' : 'file-code');
    this.contextValue = isHtml ? 'file-html' : 'file';
    this.description = '';
    this.tooltip = `Inspeccionar código en vivo de: ${this.label}`;

    // Configuración del click nativo para abrir el búfer virtual P2P de la extensión
    this.command = {
      command: 'code-sync.openStudentFile',
      title: 'Abrir Archivo Virtual',
      arguments: [this.studentId, this.filePath],
    };
  }
}
