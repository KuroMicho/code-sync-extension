# 🚀 CodeSync: Guía del Estudiante

### 1. Conexión 🔌

- Abre la barra lateral de **CodeSync** (ícono de antena `$(broadcast)`).
- Haz clic en **Unirse a una Sala**.
- Ingresa el **Código de la Sala** provisto por el profesor y tu **Nombre Completo** (Mínimo 3 caracteres para auditoría).

### 2. Sincronización Automática ⚡

- **Cero Configuraciones:** Tu código se transmite al servidor en tiempo real con un delay inteligente (Debounce).
- El sistema ignora automáticamente carpetas pesadas como `node_modules` para proteger tu ancho de banda.

### 3. Chat Cyber-Room 📟

- Haz clic en el ícono de mensajes de la barra lateral.
- Recibe las guías generales de la clase o aclaraciones privadas del docente sin salir del editor.

### 4. Soporte Técnico Directo ✋

- Si te trabas con un bug o necesitas revisión, haz clic en **Pedir Ayuda al Profe**.
- Tu espacio de trabajo se marcará en el monitor del docente para recibir asistencia prioritaria.

### 5. Exámenes y Entregas ⏳

Monitorea el temporizador global en tu barra de estado (abajo a la izquierda):

- 🟢 **Cian:** Tiempo normal de desarrollo.
- 🔴 **Rosa Neón:** ¡Últimos 30 segundos del desafío!
- 🏁 **Al llegar a 0:00:** El sistema empaqueta y envía un **Snapshot final automático** de todo tu proyecto de forma segura.

> 🛡️ **Escudo de Resiliencia:** Si sufres un microcorte de red o cierras el editor por accidente, simplemente vuelve a unirte a la sala. Tu sesión, archivos y reloj se recuperarán en el segundo exacto.

---

# 📊 CodeSync: Guía del Docente

### 1. Autenticación de Administrador 🔑

- Asegúrate de configurar previamente tu `codeSync.teacherKey` en los ajustes de VS Code (`Ctrl + ,`).
- Al unirte a una sala, introduce tu nombre seguido de tu clave maestra para activar los privilegios de administración.

### 2. Panel de Monitoreo (Dashboard) 🖥️

- Haz clic en **Abrir Monitor de Sala** desde la barra de herramientas.
- **Control en Vivo:** Visualiza el árbol de archivos de cada alumno, su estado de enfoque (si están fuera de la ventana del editor) y su ritmo de escritura (detección integrada de Copy/Paste masivo).
- **Inspección de Buffers:** Abre cualquier archivo remoto de un alumno o lanza una **Vista Previa HTML** interactiva en una pestaña dividida.

### 3. Distribución Masiva de Código 🚀

- **Enviar archivo actual:** Transmite instantáneamente la pestaña que tienes abierta en tu pantalla a las estaciones de todos los estudiantes.
- **Inyección focalizada:** Haz clic derecho sobre un alumno en el árbol para enviarle un archivo de soporte exclusivo a su espacio de trabajo.
- **Enviar todas las pestañas:** Sincroniza guías de código completas o arquitecturas base al inicio del laboratorio.

### 4. Gestión de Desafíos y Soporte ⏳

- **Iniciar Cronómetro:** Lanza un temporizador global en minutos para exámenes. El reloj se sincroniza en segundo plano en las pantallas de todos los alumnos conectados.
- **Mesa de Ayuda:** Atiende las solicitudes entrantes del panel. Al finalizar el soporte, marca la alerta como **Atendido** para limpiar tu cola de asistencia.
