# Guía de Uso Rápido: CodeSync Classroom 🎓

Bienvenido a CodeSync Classroom, la extensión que conecta a profesores y estudiantes en tiempo real. Aquí te explicamos cómo utilizar las funciones principales dependiendo de tu rol en la clase.

---

## 👨‍🏫 Para el Docente (Profesor)

El panel del docente es el centro de mando (Dashboard) desde donde controlas la clase, distribuyes ejercicios y monitoreas la actividad.

### 1. ¿Cómo crear o unirme a mi sala?
1. Abre tu VS Code.
2. Presiona `Ctrl + Shift + P` y escribe: **`CodeSync: Unirse a una Sala`**.
3. Selecciona la opción **"Docente"**.
4. Escribe tu nombre y luego ingresa la clave maestra de acceso (te la proveerá el administrador, por defecto suele ser `12345`).
5. Indica el código de tu sala (por ejemplo: `sala1` o `lab-a`).
6. Se abrirá automáticamente el **Monitor de Sala (Dashboard)** en una pestaña de tu editor.

### 2. Uso del Monitor de Sala
Desde el Panel Principal (Dashboard) tienes acceso visual a todos tus estudiantes:
- **Estado Visual:** Verás quién está conectado, desconectado, o si alguien ha abandonado VS Code para ir a otra ventana (pérdida de foco).
- **Copiar y Pegar:** CodeSync detecta si un alumno intenta pegar código masivo (posible plagio) y lo marca con un ícono de advertencia 🚩.
- **Capturas de Pantalla:** Haz clic en el botón de cámara en el perfil de un estudiante para tomar una captura instantánea de su escritorio físico (requiere que el estudiante haya enlazado su pantalla web).

### 3. Asignación de Desafíos y Exámenes
1. Abre los archivos de ejercicios que quieres que resuelvan tus estudiantes.
2. Presiona `Ctrl + Shift + P` y busca: **`CodeSync: Enviar todas las pestañas a la clase`**.
3. Esto inyectará mágicamente tu código en los editores de todos los alumnos de la sala.

### 4. Temporizador de Evaluaciones (Timer)
¿Quieres hacer un examen contra reloj?
1. En VS Code, pulsa `Ctrl + Shift + P` y escribe: **`CodeSync: Ajustar Timer / Finalizar Evaluación`**.
2. Escribe la cantidad de minutos (ej. `30`). 
3. Todos los estudiantes verán una cuenta regresiva en rojo en la parte inferior de su VS Code.
4. **¡Importante!** Al llegar a cero, el sistema recogerá automáticamente una copia de todos los archivos y pantallas de los estudiantes y los guardará en tu carpeta `ENTREGAS_CODESYNC` local para que los revises con calma.

---

## 👩‍🎓 Para el Estudiante (Alumno)

Como estudiante, CodeSync te permite recibir ejercicios instantáneamente, validar si tu código está correcto y chatear con el profesor.

### 1. ¿Cómo entrar a la clase?
1. Abre tu VS Code.
2. Presiona `Ctrl + Shift + P` y escribe: **`CodeSync: Unirse a una Sala`**.
3. Selecciona **"Estudiante"**.
4. Ingresa tu Nombre Completo (¡Usa tu nombre real para que el profe te evalúe!).
5. Ingresa el Código de la sala que el profesor escribió en el pizarrón (ej. `sala1`).
6. En la parte inferior derecha de VS Code aparecerá un ícono indicando que estás conectado.

### 2. Panel Web de Evaluación (CodeSync Client)
Para que el profesor pueda evaluar tu examen y tú puedas probar tu código, debes conectar tu pantalla:
1. Abre tu navegador web en la dirección que el profe te indique (ej. `localhost:3000`).
2. Digita el mismo código de sala y tu mismo nombre.
3. El sistema te pedirá permiso para **compartir tu pantalla completa**. Es obligatorio para los exámenes.
4. Una vez allí, verás los "Desafíos". Cuando termines de escribir tu código en VS Code, puedes presionar **"Revisar Solución"** en la web. El servidor compilará tu código en secreto y te dirá si pasaste la prueba (✅) o en qué te equivocaste (❌).

### 3. Funciones Útiles en Clase
*   **Solicitar Ayuda (Mano Virtual):** Si te estancas, en el explorador lateral de VS Code (ícono de CodeSync), dale clic al botón de "Mano levantada". El profesor recibirá una alerta en rojo en su tablero.
*   **Chat Cyber-Room:** Presiona `Ctrl + Shift + P` y escribe: **`CodeSync: Abrir Chat Cyber-Room`**. Se abrirá un chat privado con estética retro-futurista donde podrás escribirle al maestro tus dudas.

> **¡Regla de Oro!** El sistema detecta cuántas palabras por minuto (WPM) escribes y registra si te sales de VS Code a buscar respuestas en internet durante un examen. ¡Demuestra tu habilidad programando limpiamente!
