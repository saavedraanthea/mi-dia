# Mi Día 🏝️

Planificador visual diario estilo **Tiimo** con estética **Animal Crossing**, hecho como PWA: se instala en el iPhone desde Safari, funciona 100% offline y todos los datos viven en tu teléfono (nada sale a internet).

## Funciones

| Función | Dónde |
|---|---|
| Timeline visual del día (bloques de color, línea de "ahora") | pestaña **Hoy** |
| Tareas sin hora fija | sección "En cualquier momento" en Hoy |
| Modo enfoque (timer circular + subpasos + auto-avance) | píldora verde 🎯 en Hoy |
| Dictado por voz + divisor en tareas pequeñas | botón 🎤 en Hoy |
| Rutinas reutilizables y tareas repetidas (diaria/semanal) | pestaña **Rutinas** |
| To-do con prioridades Alto/Medio/Bajo | pestaña **To-do** |
| Racha 🔥, ánimo, estadísticas y tu personaje | pestaña **Progreso** |
| Traer pendientes de días anteriores | botón 📥 que aparece en Hoy |

## Instalar en iPhone

1. Abre la URL de la app en **Safari**
2. Botón **Compartir** → **Añadir a pantalla de inicio**
3. Listo: se abre a pantalla completa como app nativa

## Mapa del código (para pedir cambios)

- `index.html` — estructura de pantallas y formularios
- `styles.css` — todo el tema Animal Crossing (colores en `:root`, modo noche en `@media (prefers-color-scheme: dark)`)
- `app.js` — la lógica. Puntos útiles:
  - `TASK_LIB` — tipos de tarea que entiende el dictado (emoji, duración, subpasos)
  - `HAIR_STYLES`, `SKIN_TONES`, `SHIRT_COLORS`… — opciones del personaje
  - `buildAvatarSVG()` — el dibujo del personaje
  - `EMOJIS`, `COLORS` — opciones de las tareas
- `sw.js` — caché offline. **Al cambiar cualquier archivo, sube el número de `CACHE` (`midia-vN`)** para que los teléfonos reciban la actualización.
- `icons/` — ícono de la app

## Actualizar la app publicada

Edita los archivos, sube la versión del caché en `sw.js`, haz commit y push. El teléfono descarga la versión nueva solo, al segundo arranque de la app.

## Datos

Todo se guarda en `localStorage` del navegador bajo la clave `midia-data-v1`. Borrar los datos del sitio en Safari = empezar de cero.
