# CodeSync Extension para VS Code 📟

Esta es la extensión principal del ecosistema **CodeSync Classroom**. Permite conectar los entornos de desarrollo locales de los estudiantes con el panel de control central del docente.

## 🚀 Características Principales

*   **Sincronización en Vivo:** Monitoreo en tiempo real de los archivos de código activos.
*   **Modo Desafío (CodeSync Web):** El alumno puede recibir e inyectar automáticamente retos de programación directamente en su editor. La extensión mantiene sincronizado el estado del reto para una evaluación fluida.
*   **Sistema de Telemetría Avanzado:** Captura estadísticas en tiempo real (Pulsaciones, Pérdida de Foco de la ventana, WPM, Copiar/Pegar).
*   **Entrega Automatizada (Anti-Plagio):** Envío de snapshots completos del proyecto al finalizar el temporizador del docente de forma segura y automatizada, junto con capturas de escritorio de los estudiantes.
*   **Chat Cyber-Room:** Pestaña de comunicación interactiva integrada directamente en el entorno de VS Code.
*   **Mano Virtual (Asistencia):** Sistema de alerta visual instantánea para solicitar ayuda prioritaria al docente.

## 🛠️ Configuración (Settings)

Puedes configurar los parámetros de la extensión desde las preferencias de VS Code (`Ctrl + ,`):

*   `codeSync.serverUrl`: URL del servidor backend NestJS (Por defecto: `http://localhost:10000`).
*   `codeSync.teacherKey`: Clave maestra de autenticación docente para el blindaje y administración de salas (Por defecto en modo dev: `12345`).

## 🕹️ Comandos Principales (`Ctrl + Shift + P`)

*   `🔌 CodeSync: Unirse a una Sala` — Permite al estudiante o docente ingresar a la sesión de clase.
*   `📟 CodeSync: Abrir Chat Cyber-Room` — Abre el canal de comunicación integrado.
*   `📊 CodeSync: Abrir Monitor de Sala (Dashboard)` — *(Docente)* Despliega el panel principal de supervisión global.
*   `🚀 CodeSync: Enviar todas las pestañas a la clase` — *(Docente)* Transmite de forma agresiva y obligatoria el código base a los alumnos.
*   `⏱️ CodeSync: Ajustar Timer / Finalizar Evaluación` — *(Docente)* Dispara la recopilación de exámenes de todos los estudiantes.

## 📦 Instalación Manual (.VSIX)

1. En VS Code, abre la sección de extensiones (`Ctrl + Shift + X`).
2. Haz clic en los tres puntos (`...`) de la esquina superior derecha del panel.
3. Selecciona **Install from VSIX...** y elige el archivo empaquetador de la extensión.

---
*Desarrollado para la gestión integral y moderna de aulas de programación.*