# DevLauncher

Lanzador de escritorio para proyectos Laravel en Windows.

> **Estado:** EP-06 (Dashboard e interfaz gráfica) — catálogo por tarjetas, resumen de estado y acciones rápidas.

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

| Canal                    | Dirección       | Descripción                                          |
| ------------------------ | --------------- | ---------------------------------------------------- |
| `app:get-info`           | renderer → main | Información del entorno anfitrión                    |
| `app:ping`               | renderer → main | Prueba de eco del canal IPC                          |
| `projects:list`          | renderer → main | Lista el catálogo de proyectos                       |
| `projects:select-folder` | renderer → main | Abre el explorador de Windows y devuelve la carpeta  |
| `projects:detect`        | renderer → main | Detecta el tipo de proyecto (Laravel, React…)        |
| `projects:add`           | renderer → main | Registra un proyecto                                 |
| `projects:update`        | renderer → main | Edita nombre y/o ruta de un proyecto                 |
| `projects:delete`        | renderer → main | Elimina un proyecto del catálogo                     |
| `projects:open`          | renderer → main | Abre la carpeta del proyecto en el explorador        |
| `env:check`              | renderer → main | Detecta PHP, Node, npm, Composer, MySQL y WampServer |
| `env:check-project`      | renderer → main | Comprueba los requisitos de un proyecto              |
| `env:check-ports`        | renderer → main | Comprueba la disponibilidad de puertos               |
| `env:inspect-port`       | renderer → main | Inspecciona un puerto y el proceso que lo ocupa      |
| `settings:get`           | renderer → main | Lee las preferencias globales                        |
| `settings:update`        | renderer → main | Guarda las preferencias globales                     |
| `launcher:start`         | renderer → main | Arranca el entorno de un proyecto (EP-04)            |
| `launcher:stop`          | renderer → main | Detiene un entorno (o todos)                         |
| `launcher:stop-service`  | renderer → main | Detiene un único servicio gestionado                 |
| `launcher:status`        | renderer → main | Devuelve las sesiones de arranque                    |
| `launcher:processes`     | renderer → main | Lista los procesos gestionados (PID, puertos…)       |
| `launcher:event`         | main → renderer | Progreso del arranque y salida de los procesos       |

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

Comprueba que el equipo puede ejecutar un proyecto Laravel:

- **Herramientas**: PHP, Node.js, npm, Composer y MySQL. Para cada una se
  resuelve la ruta en este orden: **ruta configurada → WampServer → PATH**.
- **WampServer**: se busca en `C:\wamp64`, `C:\wamp`, `C:\wamp32` (o la ruta
  configurada) y se localizan PHP y MySQL dentro de `bin/`.
- **Requisitos de proyecto**: `artisan`, `composer.json`, `vendor/`, `.env`,
  `package.json` y `node_modules/`.
- **Puertos**: 3306 (MySQL), 8000 (Laravel) y 5173 (Vite).

Las rutas de los ejecutables y la de WampServer pueden fijarse manualmente en
el panel «Entorno» → «Rutas de ejecutables y preferencias».

## Motor de automatización (EP-04)

El botón **«▶ Iniciar entorno»** de cada proyecto arranca todo sin escribir
comandos. El motor ejecuta los pasos **en orden** y solo avanza cuando el
servicio anterior está listo:

| Paso             | Acción                                                            | Comprobación                    |
| ---------------- | ----------------------------------------------------------------- | ------------------------------- |
| 1. Requisitos    | Verifica `artisan`, `composer.json` y `vendor/`                   | El proyecto debe ser Laravel    |
| 2. Base de datos | Arranca WampServer **solo si** nada escucha en el puerto de MySQL | Espera al puerto (30 s)         |
| 3. PHP           | `php artisan serve --host=127.0.0.1 --port=<libre>`               | Puerto abierto + respuesta HTTP |
| 4. Vite          | `npm run dev` si el proyecto usa Vite                             | URL de Vite o puerto 5173       |

Detalles:

- El paso 2 se **omite** si el proyecto usa SQLite y se marca **listo** si MySQL
  ya está en marcha: nunca se arranca WampServer sin necesidad.
- El puerto de Laravel se elige libre a partir de 8000 para no chocar con otros
  servicios.
- Si un paso falla, el arranque se detiene y se **deshace** lo ya iniciado (no
  quedan procesos a medias).
- El panel «Entorno» muestra los pasos en vivo, las URLs resultantes y la salida
  de los procesos; **«Detener entorno»** cierra los procesos y libera los
  puertos.
- La salida de cada proceso se lee **línea a línea** (se acumula el resto entre
  lecturas) y se limpian los códigos ANSI antes de analizarla: así la URL que
  anuncia Vite se reconoce aunque llegue partida o con colores.
- Si Vite no arranca, el paso muestra el **código de salida** y las últimas
  líneas de su salida, no un «no arrancó a tiempo» sin contexto.
- Al cerrar DevLauncher se detienen los procesos que haya lanzado.

## Administración de procesos y puertos (EP-05)

Cada proyecto arrancado tiene su **propia sesión**: pueden convivir varios
entornos a la vez y cada uno se detiene por separado.

- **Sin conflictos internos**: los puertos de `artisan serve` se reservan por
  sesión; dos proyectos nunca reciben el mismo, aunque el servicio todavía no
  esté escuchando. Vite se reserva el puerto que anuncia al arrancar.
- **Conflictos externos**: al comprobar un puerto se muestra qué ejecutable lo
  ocupa y su PID (`env:inspect-port`). El panel «Puertos» del verificador también
  indica el dueño de 3306, 8000 y 5173.
- **Gestor de procesos**: el panel «Procesos y puertos» lista los procesos vivos
  con proyecto, servicio, PID, puertos y tiempo transcurrido; permite detener un
  servicio suelto, un entorno completo o todos.
- **Parada granular**: el botón de cada proyecto alterna entre «Iniciar» y
  «Detener», y cada servicio tiene su propio botón en el panel de entornos.
- **Cierre fiable**: al salir se espera a que `taskkill` termine. Además, los
  procesos se registran en `processes.json`: si la aplicación se cierra de forma
  anómala, al volver a arrancar se limpian los huérfanos comprobando que el PID
  y su fecha de creación coinciden con los registrados (nunca se mata un proceso
  ajeno que reutilizó el PID).
- **Una sola instancia**: dos DevLauncher a la vez se pisarían procesos y
  puertos, así que la segunda ventana reutiliza (y enfoca) la primera.

## Dashboard e interfaz gráfica (EP-06)

La pantalla principal es un único dashboard con todo lo necesario para operar el
catálogo sin navegar entre vistas:

- **Resumen**: cinco cifras en vivo — proyectos registrados, entornos en marcha,
  entornos arrancando, entornos con errores y servicios activos.
- **Tarjetas de proyecto**: cada proyecto muestra su estado (sin arrancar,
  arrancando, en marcha, con errores o detenido), la etiqueta de su framework, la
  ruta, los servicios en ejecución con sus puertos y, si falló, el motivo del
  error.
- **Acciones rápidas** en cada tarjeta: iniciar/detener el entorno, reiniciar,
  abrir la aplicación en el navegador cuando está lista, abrir la carpeta,
  consultar requisitos, renombrar (edición en línea) y eliminar del catálogo.
- **Filtro por framework**: chips con el número de proyectos de cada tipo, que se
  recalculan al añadir o borrar.
- **Estado en tiempo real**: el dashboard se suscribe a `launcher:event`, de modo
  que las tarjetas y las cifras se actualizan sin recargar; iniciar un entorno no
  bloquea el resto, así que pueden lanzarse varios en paralelo.
- **Estados de carga y error**: esqueletos mientras carga el catálogo, botones
  deshabilitados mientras hay una operación en curso y mensajes con la causa real
  de cada fallo.
- Al eliminar un proyecto que está en marcha, su entorno se detiene primero.

Laravel es el único framework que el motor arranca por ahora; el resto se puede
registrar y consultar, pero su arranque llegará con la compatibilidad de
frameworks (EP-10).

## Estructura

```
src/
├─ main/                 # Proceso principal (Node)
│  ├─ index.ts           # Ciclo de vida y creación de la ventana
│  ├─ ipc/               # Registro de handlers IPC (app, projects, environment, launcher)
│  └─ services/          # Lógica de negocio y persistencia
│     ├─ app.service.ts
│     ├─ command.ts              # Ejecución de comandos externos
│     ├─ environment.service.ts  # Detección de herramientas, requisitos y puertos
│     ├─ launcher.service.ts     # Motor de arranque y sesiones por proyecto (EP-04/05)
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
│     ├─ App.tsx                # Dashboard (EP-06)
│     ├─ components/            # ProjectDashboard, ProjectCard, DashboardStats,
│     │                         # LauncherPanel, PortsPanel, EnvironmentSection, …
│     ├─ lib/                   # Colores por framework y mensajes de error IPC
│     └─ styles/
└─ shared/               # Tipos, canales y constantes compartidas
   ├─ constants/
   └─ types/
```

### Alias de importación

- `@shared/*` → `src/shared/*` (disponible en main, preload y renderer)
- `@renderer/*` → `src/renderer/src/*` (solo renderer)

## Scripts

| Script              | Descripción                                |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Inicia la app en modo desarrollo (con HMR) |
| `npm run build`     | Verifica tipos y compila a `out/`          |
| `npm start`         | Previsualiza la build compilada            |
| `npm run typecheck` | Comprueba tipos de Node y del renderer     |
| `npm run lint`      | Ejecuta ESLint                             |
| `npm run format`    | Formatea con Prettier                      |

## Primer arranque

```bash
npm install
npm run dev
```

Deberías ver el dashboard con el resumen del catálogo y la tarjeta de cada
proyecto, y debajo los paneles «Entornos en marcha», «Procesos y puertos» y
«Entorno». Al elegir una carpeta con «Añadir proyecto» se detecta automáticamente
el tipo de proyecto; cada tarjeta permite consultar sus «Requisitos» y arrancar
toda la aplicación (base de datos, PHP y Vite) sin escribir ningún comando. Puedes
arrancar varios proyectos a la vez: cada uno se actualiza en su tarjeta y aparece
también en «Entornos en marcha» y «Procesos y puertos», donde se detienen de forma
individual. En el desplegable «Diagnóstico del entorno» puedes probar el canal
`app:ping`.
