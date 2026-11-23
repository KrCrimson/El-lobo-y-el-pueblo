# El Lobo y el Pueblo

Juego de roles ocultos para jugar **online en salas**, desde el celular o la PC. Un jugador crea una sala, comparte el código y el servidor hace de narrador: reparte los roles en secreto, controla la noche y el día, cuenta los votos y decide quién gana.

Inspirado en los juegos de deducción social tipo *Mafia / Werewolf*. Las reglas son una versión propia y simplificada; el nombre, los textos y los gráficos son originales.

## Cómo se juega

1. Entras con un nombre (sin cuenta) y creas una sala, o te unes con el código de 4 letras o con el enlace.
2. El anfitrión elige los roles y empieza (de **5 a 12** jugadores).
3. **Noche:** los lobos eligen a una víctima; la vidente descubre un rol; la bruja puede curar o envenenar.
4. **Día:** se anuncian las muertes (con su rol) y el pueblo vota a quién linchar.
5. Ganan **los aldeanos** si eliminan a todos los lobos, y **los lobos** si igualan en número a los demás.

Roles: aldeano, lobo, vidente, bruja y cazador.

**Simplificaciones:** no hay capitán, un empate en la votación significa que nadie muere, y la bruja decide curar y/o envenenar en una sola acción. Si alguien no actúa a tiempo, el servidor juega por él (lobos 60 s, vidente y bruja 40 s, cazador 30 s, votación 120 s).

## Probarlo en tu PC

Requiere Node.js 22 o superior.

```bash
npm run instalar        # instala servidor y cliente
npm run dev:servidor    # terminal 1  → http://localhost:3001
npm run dev:cliente     # terminal 2  → http://localhost:5173
```

Abre `http://localhost:5173`. Para probar con varias personas en tu casa, abre desde otros celulares o PCs conectados a la **misma red wifi** la dirección `http://IP-DE-TU-PC:5173` (el cliente busca el servidor en esa misma IP, puerto 3001). Si el firewall de Windows lo pide, permite el acceso a Node.js en redes privadas.

Cada navegador es un jugador distinto: el identificador se guarda en `localStorage`, así que dos pestañas del mismo navegador cuentan como la misma persona. Para pruebas solo, usa navegadores o perfiles distintos.

## Pruebas

```bash
npm test
```

38 pruebas con el ejecutor de Node (sin dependencias): reglas del juego, 300 partidas simuladas, salas, temporizadores, reconexión y una **partida completa por WebSocket** que verifica lo que viaja por la red.

## Estructura

```
servidor/
  juego.js      reglas puras (sin red ni base de datos) y la "vista" de cada jugador
  salas.js      salas, anfitrión, temporizadores y reconexión
  index.js      Socket.IO: valida datos, limita eventos y envía a cada quien SU vista
cliente/        Vite + React (celular primero, dos columnas en PC)
```

## Privacidad y seguridad

- **Cada jugador solo recibe su propia información.** El servidor nunca envía los roles de otros jugadores vivos, los votos de los lobos ni los tokens de sesión. Hay pruebas que lo verifican, incluso sobre los mensajes reales de la red.
- La fase de la noche (lobos, vidente, bruja) solo se detalla a quien actúa, y la noche dura un mínimo fijo: así nadie deduce qué roles siguen vivos por el tiempo que tarda el amanecer.
- No hay cuentas, ni base de datos, ni datos personales: las partidas viven en la memoria del servidor y se borran al terminar. Solo se guarda en el navegador un identificador aleatorio y el último nombre usado.
- Validación de todos los datos que llegan, límite de eventos por conexión, tamaño máximo de mensaje, límite de 100 salas y CORS por lista de orígenes.

## Despliegue (gratis)

### 1. Servidor en Render

Servicio **Web Service** desde este repositorio (la raíz tiene un `render.yaml`):

- Build: `npm install` · Start: `node servidor/index.js`
- Variable **`CORS_ORIGIN`** = la dirección del cliente (por ejemplo `https://el-lobo.vercel.app`), sin barra final. Varias, separadas por coma.
- `NODE_ENV=production`. El puerto lo asigna Render.

En el plan gratuito el servicio **se duerme** tras un rato sin uso (la primera conexión tarda hasta un minuto) y **las partidas en curso se pierden si se reinicia**.

### 2. Cliente en Vercel

- Proyecto desde el mismo repositorio, **Root Directory** = `cliente`, framework Vite.
- Variable **`VITE_SERVIDOR_URL`** = la dirección del servidor de Render (por ejemplo `https://el-lobo-servidor.onrender.com`). Se lee al compilar: si la cambias, vuelve a desplegar.

## Pendiente / ideas

- Más roles (cupido, niña, ladrón) y capitán.
- Chat de texto dentro de la sala (por ahora se juega con una llamada aparte).
- Sonidos y animaciones de noche y día.
