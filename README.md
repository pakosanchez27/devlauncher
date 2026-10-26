# DevLauncher

Lanzador de escritorio para proyectos PHP y JavaScript en Windows.

> **Estado:** EP-08 (Registros y diagnóstico) · interfaz renovada con navegación por secciones.

## Stack

- **Electron** — aplicación de escritorio
- **React 19 + TypeScript** — interfaz (renderer)
- **Vite (electron-vite)** — empaquetado y servidor de desarrollo
- **Tailwind CSS 4** — estilos
- **ESLint + Prettier** — calidad y formato

## Comunicación segura (IPC)

El renderer **no** tiene acceso a Node (`nodeIntegration: false`) y usa
`contextIsolation: true`. La comunicación con el proceso principal se realiza
únicamente a través de la superficie blanca y tipada que define el preload.

Flujo de un canal:

1. **Nombre del canal** → `src/shared/constants/channels.ts` (única fuente de verdad).
2. **Contrato de datos** → `src/shared/types/ipc.ts`.
3. **Handler** en el proceso principal → `src/main/ipc/*.ipc.ts` (`ipcMain.handle`).
4. **Exposición al renderer** → `src/preload/index.ts` (`contextBridge`).
5. **Consumo** → `window.api.*` en los componentes React.

### Añadir un canal nuevo

1. Añade la constante en `IPC_CHANNELS` y su tipo en `src/shared/types/ipc.ts`.
2. Implementa la lógica en `src/main/services/` y regístrala en `src/main/ipc/`.
3. Expón el método en el objeto `api` del preload.
4. Úsalo desde el renderer con `window.api.tuMetodo()`.

### Canales disponibles

| Canal                    | Dirección       | Descripción                                                |
| ------------------------ | --------------- | ---------------------------------------------------------- |
| `app:get-info`           | renderer → main | Información del entorno anfitrión                          |
| `app:ping`               | renderer → main | Prueba de eco del canal IPC                                |
| `app:copy-text`          | renderer → main | Copia texto al portapapeles del sistema (EP-08)            |
| `projects:list`          | renderer → main | Lista el catálogo de proyectos                             |
| `projects:select-folder` | renderer → main | Abre el explorador de Windows y devuelve la carpeta        |
| `projects:select-php`    | renderer → main | Elige el `php.exe` de un proyecto concreto                 |
| `projects:detect`        | renderer → main | Detecta el tipo de proyecto (Laravel, React…)              |
| `projects:add`           | renderer → main | Registra un proyecto                                       |
| `projects:update`        | renderer → main | Edita nombre, ruta y/o versión de PHP de un proyecto       |
| `projects:delete`        | renderer → main | Elimina un proyecto del catálogo                           |
| `projects:open`          | renderer → main | Abre la carpeta del proyecto en el explorador              |
| `projects:open-editor`   | renderer → main | Abre el proyecto en el editor configurado (EP-07)          |
| `env:check`              | renderer → main | Detecta PHP, Node, npm, Composer, MySQL y WampServer       |
| `env:check-project`      | renderer → main | Comprueba los requisitos de un proyecto según su framework |
| `env:check-ports`        | renderer → main | Comprueba la disponibilidad de puertos                     |
| `env:inspect-port`       | renderer → main | Inspecciona un puerto y el proceso que lo ocupa            |
| `env:list-php`           | renderer → main | Lista las instalaciones de PHP disponibles                 |
| `env:inspect-php`        | renderer → main | Valida una ruta de PHP y devuelve su versión               |
| `settings:get`           | renderer → main | Lee las preferencias globales                              |
| `settings:update`        | renderer → main | Guarda las preferencias globales                           |
| `launcher:start`         | renderer → main | Arranca el entorno de un proyecto (EP-04)                  |
| `launcher:stop`          | renderer → main | Detiene un entorno (o todos)                               |
| `launcher:stop-service`  | renderer → main | Detiene un único servicio gestionado                       |
| `launcher:status`        | renderer → main | Devuelve las sesiones de arranque                          |
| `launcher:processes`     | renderer → main | Lista los procesos gestionados (PID, puertos…)             |
| `launcher:open-url`      | renderer → main | Abre la aplicación en el navegador configurado (EP-07)     |
| `launcher:event`         | main → renderer | Progreso del arranque y salida de los procesos             |
| `logs:export`            | renderer → main | Guarda un registro en un archivo elegido por el usuario    |

### Almacenamiento

El catálogo se guarda en `projects.json` y las preferencias en `settings.json`,
dentro de la carpeta de datos de usuario de la aplicación
(`app.getPath('userData')`). La escritura es atómica (fichero temporal +
`rename`) para evitar corrupciones.

## Detección del tipo de proyecto

Al añadir una carpeta, DevLauncher inspecciona archivos y dependencias y
clasifica el proyecto (de más específico a más genérico):

| Tipo        | Señales                                                        |
| ----------- | -------------------------------------------------------------- |
| Laravel     | `artisan` o `laravel/framework` en `composer.json`             |
| CodeIgniter | `spark`, `codeigniter4/framework` o `system/` + `application/` |
| Symfony     | `bin/console` o `symfony/framework-bundle`                     |
| WordPress   | `wp-config.php` o carpeta `wp-content/`                        |
| Next.js     | `next` en `package.json`                                       |
| React       | `react` en `package.json`                                      |
| Vue         | `vue`/`nuxt` en `package.json`                                 |
| Node.js     | `package.json` sin framework reconocido                        |
| PHP         | `composer.json` sin framework reconocido                       |
| Desconocido | sin señales reconocibles                                       |

El tipo se vuelve a evaluar al listar el catálogo, de modo que las entradas
antiguas se corrigen automáticamente. Cada tipo se muestra con una etiqueta de
color distintiva, inspirada en la marca del framework.

## Verificador de entorno

Comprueba que el equipo puede ejecutar un proyecto:

- **Herramientas**: PHP, Node.js, npm, Composer y MySQL. Para cada una se
  resuelve la ruta en este orden: **ruta configurada → WampServer → PATH**.
- **WampServer**: se busca en `C:\wamp64`, `C:\wamp`, `C:\wamp32` (o la ruta
  configurada) y se localizan PHP y MySQL dentro de `bin/`.
- **Requisitos de proyecto**: propios de cada framework (por ejemplo `artisan`,
  `composer.json` y `vendor/` en Laravel; `package.json` y `node_modules/` en un
  proyecto Node).
- **Puertos**: 3306 (MySQL), 3000 (Next.js), 8000 (servidores PHP) y 5173 (Vite).

Las rutas de los ejecutables, la de WampServer, la del editor y la del navegador
pueden fijarse manualmente en **Ajustes → Preferencias**, donde también se decide
si el proyecto se abre en el editor al arrancar. El PHP de Ajustes es el global;
cada proyecto puede fijar su propia versión desde el botón **PHP** de su tarjeta.

## Motor de automatización (EP-04)

El botón **«▶ Iniciar entorno»** de cada proyecto arranca todo sin escribir
comandos. El motor ejecuta el **plan de su framework** (EP-10) y avanza solo
cuando el servicio anterior está listo:

| Paso             | Acción                                                                | Comprobación                     |
| ---------------- | --------------------------------------------------------------------- | -------------------------------- |
| 1. Requisitos    | Verifica los archivos y dependencias que exige el framework           | Todos los obligatorios presentes |
| 2. Editor        | Abre la carpeta del proyecto en VS Code (o el editor configurado)     | El lanzador responde             |
| 3. Base de datos | Arranca WampServer si MySQL no escucha (y si la bandeja está cerrada) | Puerto de MySQL (60 s)           |
| 4. Servidor      | `artisan serve`, `spark serve`, `php -S` o `npm run dev`              | Puerto abierto o URL anunciada   |
| 5. Frontend      | `npm run dev` con Vite, si es un proyecto PHP que lo declara          | URL de Vite o puerto 5173        |

Los pasos 3 y 5 solo existen si el framework los necesita: un proyecto React
arranca únicamente requisitos → editor → servidor.

Detalles:

- El paso 2 se puede desactivar en **Ajustes → Preferencias**; si no se encuentra
  VS Code se abre la carpeta en el Explorador de Windows y el arranque continúa
  igual.
- El paso 3 se **omite** si el proyecto usa SQLite y se marca **listo** si MySQL
  ya está en marcha. Si MySQL escucha pero la bandeja de WAMP está cerrada, se
  abre WampServer sin esperar; si no escucha, se lanza WAMP y se espera al
  puerto.
- `wampmanager.exe` pide permisos de administrador: Windows puede mostrar su
  aviso (UAC). Si se deniega, el paso lo explica en vez de esperar en vano.
- El puerto de los servidores PHP se elige libre a partir de 8000 para no chocar
  con otros servicios. Los dev servers de Node eligen su puerto y se reserva el
  que anuncian.
- Si un paso falla, el arranque se detiene y se **deshace** lo ya iniciado (no
  quedan procesos a medias).
- La vista **Actividad** muestra los pasos en vivo, las URLs resultantes y la
  salida de los procesos; **«Detener»** cierra los procesos y libera los puertos.
- La salida de cada proceso se lee **línea a línea** (se acumula el resto entre
  lecturas) y se limpian los códigos ANSI antes de analizarla: así la URL que
  anuncia el servidor se reconoce aunque llegue partida o con colores.
- Si un servicio no arranca, el paso muestra el **código de salida** y las
  últimas líneas de su salida, no un «no arrancó a tiempo» sin contexto.
- Al cerrar DevLauncher se detienen los procesos que haya lanzado.

## Administración de procesos y puertos (EP-05)

Cada proyecto arrancado tiene su **propia sesión**: pueden convivir varios
entornos a la vez y cada uno se detiene por separado.

- **Sin conflictos internos**: los puertos de los servidores PHP se reservan por
  sesión; dos proyectos nunca reciben el mismo, aunque el servicio todavía no
  esté escuchando. Los dev servers de Node reservan el puerto que anuncian.
- **Conflictos externos**: al comprobar un puerto se muestra qué ejecutable lo
  ocupa y su PID (`env:inspect-port`). La tarjeta «Puertos» de **Ajustes** también
  indica el dueño de 3306, 8000 y 5173.
- **Gestor de procesos**: **Ajustes → Procesos gestionados** lista los procesos
  vivos con proyecto, servicio, PID, puertos y tiempo transcurrido; permite
  detener un servicio suelto, un entorno completo o todos.
- **Parada granular**: el botón de cada proyecto alterna entre «Iniciar» y
  «Detener», y cada servicio tiene su propio botón en **Actividad**.
- **Cierre fiable**: al salir se espera a que `taskkill` termine. Además, los
  procesos se registran en `processes.json`: si la aplicación se cierra de forma
  anómala, al volver a arrancar se limpian los huérfanos comprobando que el PID
  y su fecha de creación coinciden con los registrados (nunca se mata un proceso
  ajeno que reutilizó el PID).
- **Una sola instancia**: dos DevLauncher a la vez se pisarían procesos y
  puertos, así que la segunda ventana reutiliza (y enfoca) la primera.

## Interfaz y experiencia de uso (EP-06)

La interfaz se organiza en tres secciones con una barra lateral que muestra el
estado en vivo:

- **Proyectos**: el catálogo. Un resumen compacto (en marcha, arrancando, con
  errores y servicios activos), filtros por framework y una tarjeta por proyecto.
  Cada tarjeta muestra el estado, el framework, la ruta, los servicios con sus
  puertos y, durante el arranque, el paso actual con una barra de progreso. La
  acción principal cambia con el estado: «Iniciar entorno», «Abrir aplicación» +
  «Detener», o «Reintentar» si falló. Editor, carpeta y requisitos quedan como
  acciones secundarias, y renombrar/eliminar viven en el menú «⋯».
- **Actividad**: los entornos activos con la línea de pasos, las URLs, los
  servicios y la salida de cada proceso (desplegable por entorno, con filtros,
  búsqueda, copia y exportación). Desde aquí se detiene un entorno, un servicio
  suelto o todos.
- **Ajustes**: herramientas detectadas, WampServer, puertos, preferencias
  (ejecutables, editor, navegador, abrir en editor al arrancar), diagnóstico del
  entorno y diagnóstico técnico.

Detalles de la experiencia:

- **Sin jerga interna**: la interfaz no muestra números de épica ni detalles de
  IPC; habla de proyectos, entornos y servicios.
- **Estados vacíos guiados**: sin proyectos se explica el flujo completo (añadir
  carpeta → iniciar entorno → abrir aplicación); sin entornos activos, «Actividad»
  invita a ir a Proyectos.
- **Avisos junto a la acción**: los resultados y errores aparecen como avisos
  flotantes y no como un banner lejano; cada tarjeta conserva además el error del
  último arranque con acceso directo a «Actividad».
- **Operaciones independientes**: iniciar, detener o abrir un proyecto no bloquea
  el resto de tarjetas.
- **Estado en tiempo real**: una sola suscripción a `launcher:event` actualiza la
  barra lateral, las tarjetas y la vista de actividad sin recargar.
- **Confirmaciones propias**: eliminar un proyecto y registrar un framework no
  reconocido usan un diálogo modal, no el `confirm` del sistema.
- **Accesibilidad**: foco visible, etiquetas `aria` en iconos y menús, diálogos
  modales y textos con mayor contraste y tamaño.
- Al eliminar un proyecto que está en marcha, su entorno se detiene primero.

Cualquier framework soportado por el motor (EP-10) se puede arrancar desde su
tarjeta; el tipo no reconocido muestra el motivo en el primer paso.

## Compatibilidad de frameworks (EP-10)

El motor no está atado a Laravel: cada framework tiene un **plan de arranque**
en `src/main/services/launch-plan.ts` que decide qué pasos se ejecutan, con qué
comando y qué comprobación de requisitos se aplica.

| Framework   | Servidor principal                                      | Base de datos               | Frontend            |
| ----------- | ------------------------------------------------------- | --------------------------- | ------------------- |
| Laravel     | `php artisan serve --host=127.0.0.1 --port=<libre>`     | `.env` (o SQLite)           | Vite, si lo declara |
| CodeIgniter | `php spark serve` (CI4) o `php -S … -t <docroot>` (CI3) | `.env` (o SQLite)           | —                   |
| Symfony     | `php -S 127.0.0.1:<libre> -t public`                    | `.env` (o SQLite)           | Vite, si lo declara |
| WordPress   | `php -S 127.0.0.1:<libre> -t <docroot>`                 | `wp-config.php` (`DB_HOST`) | —                   |
| Next.js     | `npm run dev` (o `start`/`serve`)                       | —                           | —                   |
| React       | `npm run dev` (o `start`/`serve`)                       | —                           | —                   |
| Vue         | `npm run dev` (o `start`/`serve`)                       | —                           | —                   |
| Node.js     | `npm run dev` (o `start`/`serve`)                       | —                           | —                   |
| PHP         | `php -S 127.0.0.1:<libre> -t <docroot>`                 | —                           | —                   |

Detalles:

- **Document root**: si el proyecto tiene `public/` se sirve esa carpeta (Laravel,
  Symfony, CodeIgniter 4, WordPress Bedrock); si no, la raíz del proyecto.
- **Requisitos por framework**: Laravel exige `artisan`, `composer.json` y
  `vendor/`; Symfony `bin/console`, `composer.json` y `vendor/`; CodeIgniter
  `spark` o las carpetas `application/` + `system/`; WordPress `wp-config.php`;
  los proyectos Node `package.json` y `node_modules/`. El panel «Requisitos» de
  cada tarjeta usa la misma comprobación que el motor.
- **Script de arranque de Node**: se usa el primero disponible entre `dev`,
  `start` (Create React App) y `serve` (Vue CLI). Si `package.json` no declara
  ninguno, el arranque explica el motivo en vez de fallar sin contexto.
- **Base de datos**: solo se comprueba en los frameworks que la usan, con el
  puerto que declare el proyecto (`.env` o `wp-config.php`) y MySQL ya en marcha
  no se vuelve a arrancar.
- **Dev servers de Node**: DevLauncher no impone el puerto; espera a que el
  servidor anuncie su URL (`Local: http://…`) y reserva el puerto anunciado.
- Un framework sin plan (tipo no reconocido) falla en el primer paso con un
  mensaje que explica qué falta, y no se queda ningún proceso vivo.

### Versión de PHP por proyecto

El PHP de **Ajustes** es el global, pero cada proyecto puede fijar su propia
versión desde el botón **PHP** de su tarjeta. El selector detecta las versiones
de WampServer (`bin/php/php*`), la ruta global y el PHP del PATH, y también
permite elegir un `php.exe` concreto.

- Sin versión fijada (`phpPath: null`), el proyecto usa el PHP global y sigue sus
  cambios en **Ajustes**.
- Una ruta concreta se guarda en `projects.json` y se usa al ejecutar
  `artisan serve`, `spark serve` o `php -S`; npm y Composer no cambian.
- Si la ruta fijada deja de ser válida, el arranque falla con un mensaje claro en
  vez de usar otra versión sin avisar.
- El cambio se aplica en el siguiente arranque o reinicio del entorno.

## Empaquetado y distribución (EP-11)

`npm run dist` compila la aplicación y genera en `dist/` los artefactos para
Windows x64:

| Artefacto                      | Descripción                                                               |
| ------------------------------ | ------------------------------------------------------------------------- |
| `DevLauncher-<v>-setup.exe`    | Instalador NSIS por usuario (sin permisos de administrador)               |
| `DevLauncher-<v>-portable.exe` | Ejecutable portable: no instala nada y se extrae a una carpeta temporal   |
| `latest.yml`                   | Metadatos del build (versión, tamaño y hash) para futuras actualizaciones |
| `win-unpacked/`                | Aplicación sin empaquetar, útil para depurar el ejecutable                |

Detalles:

- La configuración está en `electron-builder.yml` y el icono en
  `build/icon.ico` (16, 24, 32, 48, 64, 128 y 256 px).
- El `appId` es `com.devlauncher.app`, el mismo que usa
  `electronApp.setAppUserModelId` para que las notificaciones y la barra de
  tareas de Windows asocien la ventana con la aplicación.
- Solo se empaqueta `out/` y `package.json` dentro de un archivo `asar`: el
  código fuente, los tests y las herramientas de desarrollo no viajan.
- `npm run pack` genera únicamente `dist/win-unpacked/`, más rápido para probar
  el ejecutable empaquetado.
- No hay firma de código configurada: Windows SmartScreen mostrará un aviso la
  primera vez que se ejecute el instalador.
- Los datos de la aplicación (`projects.json`, `settings.json`,
  `processes.json`) se guardan en `%APPDATA%\DevLauncher` en la versión
  empaquetada y en `%APPDATA%\devlauncher` en desarrollo, de modo que el
  catálogo de desarrollo no aparece en la aplicación instalada.

## Editor y WampServer al arrancar (EP-12)

Pulsar «▶ Iniciar entorno» deja el proyecto listo para trabajar: además de los
servicios, DevLauncher abre la carpeta en el editor y se asegura de que
WampServer esté en marcha.

**Editor.** Se resuelve en este orden: ruta indicada en **Ajustes** → `code.cmd`
del PATH → instalación habitual de VS Code → Explorador de Windows. Sirve
cualquier editor con lanzador de línea de comandos (VS Code, Cursor…). El paso
nunca hace fallar el arranque: si el editor no aparece, se informa y el entorno
sigue.

**WampServer.** El paso de base de datos comprueba primero el puerto de MySQL:

- Si nada escucha, lanza `wampmanager.exe` y espera hasta 60 s a que MySQL
  responda (WAMP arranca Apache y MySQL como servicios de Windows).
- Si MySQL ya escucha pero la bandeja de WAMP está cerrada, abre la bandeja sin
  bloquear; si está abierta, no hace nada.
- Si WAMP estaba abierto y MySQL no responde, da 15 s y explica el motivo
  (MySQL detenido en la bandeja, puerto distinto o permisos denegados).

## Integración con herramientas de desarrollo (EP-07)

Además del arranque automático, cada tarjeta ofrece accesos directos al código y a
la aplicación:

- **Abrir en editor**: abre la carpeta del proyecto en el editor configurado sin
  arrancar el entorno. Usa el mismo orden de resolución que el paso del arranque
  (ruta de **Ajustes** → `code.cmd` del PATH → instalación habitual → Explorador).
- **Abrir aplicación**: abre la URL del servidor principal en el navegador
  configurado; en proyectos solo de frontend usa la URL de Vite. La URL la resuelve
  el proceso principal desde la sesión de arranque, no el renderer, y solo se
  admiten direcciones `http`/`https`.
- **Navegador preferido**: se indica en **Ajustes → Preferencias**. Vacío usa el
  navegador predeterminado de Windows; si la ruta configurada no existe o falla,
  se recurre al predeterminado y se informa del motivo.

## Registros y diagnóstico (EP-08)

La vista **Actividad** conserva la salida de cada proceso mientras el entorno
sigue en marcha y la muestra en un visor preparado para diagnosticar fallos:

- **Filtros por servicio** (PHP, Vite, Node…) y por nivel: todo, problemas
  (avisos y errores) o solo errores.
- **Búsqueda** dentro de la salida y **resaltado** de errores y avisos. Cada
  línea lleva la hora en que llegó y el servicio que la emitió.
- **Seguir salida** automático, que se desactiva al desplazarse hacia arriba y
  se puede recuperar con «Ir al final».
- **Copiar** las líneas visibles, **exportar** a un archivo `.log` o **vaciar**
  el registro del proyecto.
- **Copiar detalles** desde el aviso de fallo: proyecto, ruta, pasos, servicios
  y las últimas 100 líneas, listo para pegar en un informe.
- **Diagnóstico del entorno** en **Ajustes**: herramientas disponibles, puertos
  ocupados y WampServer, con un botón para copiar el informe completo.

La salida se guarda en memoria (máximo 500 líneas por proyecto) y se conserva al
cambiar de sección; al cerrar la aplicación se descarta. La exportación usa el
diálogo nativo de Windows y no depende de permisos del renderer.

## Estructura

```
src/
├─ main/                 # Proceso principal (Node)
│  ├─ index.ts           # Ciclo de vida y creación de la ventana
│  ├─ ipc/               # Registro de handlers IPC (app, projects, environment, launcher, logs)
│  └─ services/          # Lógica de negocio y persistencia
│     ├─ app.service.ts
│     ├─ browser.service.ts      # Apertura de la aplicación en el navegador (EP-07)
│     ├─ command.ts              # Ejecución de comandos externos
│     ├─ editor.service.ts       # Apertura del proyecto en el editor (EP-07/EP-12)
│     ├─ environment.service.ts  # Detección de herramientas, requisitos y puertos
│     ├─ launcher.service.ts     # Motor de arranque y sesiones por proyecto (EP-04/05/10)
│     ├─ launch-plan.ts          # Plan de arranque de cada framework (EP-10)
│     ├─ ports.service.ts        # Reserva de puertos y dueño de cada puerto (EP-05)
│     ├─ process.service.ts      # Procesos de larga duración (spawn/kill) y huérfanos
│     ├─ process.repository.ts   # Persistencia de procesos (limpieza tras un cierre anómalo)
│     ├─ readiness.ts            # Puertos y espera a que un servicio esté listo
│     ├─ events.ts               # Emisión de eventos del motor al renderer
│     ├─ settings.service.ts     # Preferencias globales
│     ├─ settings.repository.ts  # Persistencia en settings.json
│     ├─ project.service.ts      # Detección del tipo de proyecto + CRUD
│     └─ project.repository.ts   # Persistencia en projects.json
├─ preload/
│  ├─ index.ts           # Puente contextBridge (API segura)
│  └─ env.d.ts           # Tipado de window.api / window.electron
├─ renderer/             # Interfaz React
│  ├─ index.html
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx                # Navegación entre secciones
│     ├─ components/
│     │  ├─ layout/Sidebar.tsx  # Marca, secciones y estado en vivo
│     │  ├─ ProjectsView.tsx    # Catálogo, filtros y acciones
│     │  ├─ ActivityView.tsx    # Entornos, pasos y registros
│     │  ├─ SettingsView.tsx    # Herramientas, preferencias y diagnóstico
│     │  ├─ LogViewer.tsx       # Visor de salida con filtros (EP-08)
│     │  ├─ DiagnosticsSummary.tsx # Resumen y copia del diagnóstico (EP-08)
│     │  ├─ ProjectCard.tsx / ProjectRequirements.tsx / DashboardStats.tsx
│     │  ├─ PhpVersionDialog.tsx  # Selector de PHP por proyecto (EP-10)
│     │  ├─ PortsPanel.tsx / AppInfoCard.tsx / PingPanel.tsx
│     │  └─ ui/                 # Button, Badge, Icon, Toast, ConfirmDialog…
│     ├─ lib/                   # Estado de arranque, etiquetas, formato de registros y errores IPC
│     └─ styles/
└─ shared/               # Tipos, canales y constantes compartidas
   ├─ constants/
   └─ types/
```

Archivos de configuración y recursos, fuera de `src/`:

- `electron-builder.yml` — empaquetado y distribución (EP-11).
- `build/icon.ico` — icono de la aplicación (16–256 px).

### Alias de importación

- `@shared/*` → `src/shared/*` (disponible en main, preload y renderer)
- `@renderer/*` → `src/renderer/src/*` (solo renderer)

## Scripts

| Script              | Descripción                                     |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Inicia la app en modo desarrollo (con HMR)      |
| `npm run build`     | Verifica tipos y compila a `out/`               |
| `npm run pack`      | Empaqueta sin instalador (`dist/win-unpacked/`) |
| `npm run dist`      | Genera el instalador y la versión portable      |
| `npm start`         | Previsualiza la build compilada                 |
| `npm run typecheck` | Comprueba tipos de Node y del renderer          |
| `npm run lint`      | Ejecuta ESLint                                  |
| `npm run format`    | Formatea con Prettier                           |

## Primer arranque

```bash
npm install
npm run dev
```

Deberías ver la sección **Proyectos** con el resumen y una tarjeta por proyecto (o
los pasos para añadir el primero). Al elegir una carpeta con «Añadir proyecto» se
detecta automáticamente el tipo de proyecto; cada tarjeta permite consultar sus
«Requisitos» y arrancar toda la aplicación (base de datos, servidor del framework
y frontend cuando aplica) sin escribir ningún comando. Puedes arrancar varios
proyectos a la vez: cada uno se actualiza en su tarjeta y aparece en **Actividad**
con sus pasos y la salida de los procesos, donde se detienen de forma individual.
La salida se puede filtrar por servicio y nivel, buscar, copiar o exportar, y el
aviso de fallo permite copiar un informe con los detalles.
En **Ajustes** están las herramientas detectadas, los puertos, las preferencias, el
diagnóstico del entorno (con un informe copiable) y el diagnóstico técnico
(incluida la prueba del canal `app:ping`).

Para generar el instalador, ejecuta `npm run dist` y abre
`dist/DevLauncher-0.1.0-setup.exe` (o la versión portable, que no requiere
instalación).
