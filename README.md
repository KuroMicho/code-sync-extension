# CodeSync Classroom 📟

Sistema de sincronización y monitoreo de código en tiempo real diseñado para laboratorios de programación y entornos educativos. Permite la supervisión interactiva entre docentes y estudiantes de forma ligera, estética y eficiente.

## 🚀 Características Principales

* **Sincronización en Vivo:** Monitoreo en tiempo real de los archivos de código activos desde la vista del panel docente.
* **Modo Desafío (Timer):** Control de tiempos límite para exámenes y retos con alertas visuales y sonoras integradas.
* **Chat Cyber-Room:** Pestaña de comunicación interactiva con estética neón integrada directamente en el entorno de desarrollo.
* **Mano Virtual (Asistencia):** Sistema de alerta visual instantánea en el panel del profesor para soporte prioritario.
* **Entrega Automatizada:** Envío de snapshots completos del proyecto al finalizar el temporizador de forma segura.

## 🛠️ Configuración (Settings)

Puedes configurar los parámetros de la extensión desde las preferencias de VS Code (`Ctrl + ,`):

* `codeSync.serverUrl`: URL del servidor backend NestJS (Por defecto: `http://localhost:10000`).
* `codeSync.teacherKey`: Clave maestra de autenticación docente para el blindaje y administración de salas.

## 🕹️ Comandos Principales (`Ctrl + Shift + P`)

* `🔌 CodeSync: Unirse a una Sala` — Permite al estudiante o docente ingresar a la sesión de clase.
* `📟 CodeSync: Abrir Chat Cyber-Room` — Abre el canal de comunicación integrado.
* `📊 CodeSync: Abrir Monitor de Sala (Dashboard)` — *(Docente)* Despliega el panel de supervisión.
* `🚀 CodeSync: Enviar todas las pestañas a la clase` — *(Docente)* Transmite el código base a los alumnos.

## 📦 Instalación Manual (.VSIX)

1. En VS Code, abre la sección de extensiones (`Ctrl + Shift + X`).
2. Haz clic en los tres puntos (`...`) de la esquina superior derecha del panel.
3. Selecciona **Install from VSIX...** y elige el archivo empaquetador de la extensión.

---
*Desarrollado por kevin-rodriguez para la gestión optimizada de aulas de programación.*