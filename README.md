# Convivio ALMO 2026 · Gotcha & Go-Karts

Registro con selfie + gorritas, escuadrones de 5, pase VIP y rifa en vivo en todos los celulares.

## Correr en local

```bash
npm install
npm start
```

La consola muestra la URL de red local (ej. `http://192.168.1.20:3000`). Todos deben estar en el mismo Wi-Fi.

| Pantalla | URL |
|---|---|
| Registro / Pase VIP (QR de la entrada) | `/` |
| Kiosko iPad (pide PIN, no guarda sesión) | `/?modo=ipad` |
| Arena en vivo | `/arena` |
| Panel staff (sorteos, boletos extra, QR) | `/admin` |

PIN por defecto: `2026` (cámbialo con `ADMIN_PIN=xxxx npm start`).

## Docker (servidor)

```bash
./run.sh              # build + levanta en segundo plano (puerto 3000)
./run.sh logs         # ver logs
./run.sh stop         # detener
./run.sh restart      # reconstruir tras cambios
./run.sh local        # sin Docker: npm install + npm start
ADMIN_PIN=4821 HOST_PORT=8080 ./run.sh   # PIN y puerto propios
```

Los datos (jugadores, fotos, ganadores) quedan en `./data`, fuera del contenedor.

## nginx

Usa `nginx.conf.example`. Lo indispensable:
- **Subdominio propio** (ej. `convivio.tudominio.com`); la app no funciona en una subcarpeta.
- **HTTPS** (certbot): sin HTTPS los celulares no dan la cámara en vivo.
- **WebSocket** en `/socket.io/`: `proxy_http_version 1.1`, `Upgrade` y `Connection` + `proxy_read_timeout` largo. Sin esto no se ven los sorteos en vivo.
- **`client_max_body_size 10m`**: si no, las selfies fallan con error 413.

## Notas
- **Cámara:** los navegadores solo dan la cámara en vivo en `https://` o en `localhost`.
  - Celular por `http://IP`: se abre la cámara nativa del teléfono (funciona).
  - Laptop/Mac por `http://IP`: la app muestra un botón "Abrir versión segura" → `https://IP:3443` (certificado propio: "Avanzado → Continuar").
  - **Día del evento (recomendado):** `npm run tunnel` da una URL `https://…trycloudflare.com` válida sin avisos en cualquier equipo. Pégala en `/admin` → QR → "URL pública" para generar el QR.
  - Si sale "permiso bloqueado" en Mac: Ajustes del Sistema → Privacidad y seguridad → Cámara → activa el navegador.
- Si el puerto 3000 está ocupado, el servidor usa el siguiente libre (mira la consola).
- **Escuadrones:** se llenan en orden de llegada (Alpha con los primeros 5, luego Viper…), para que el primer grupo empiece a jugar ya.
- **Puntos:** cada jugador empieza con 1; los jueces dan +1 al MVP (una vida extra).
- **Eliminación:** en `/admin` defines cuántos regalos hay y en cada ronda a cuántos jugadores quitarles 1 punto. Con 0 quedan fuera; nunca baja del número de regalos.
- **Tómbola de finalistas:** sortea el premio #N entre quienes tienen puntos y aún no ganan. **Premio para TODOS:** participan todos los registrados.
- Tocar la foto o tarjeta de cualquier jugador abre su perfil y su escuadrón.
- Los datos se guardan en `data/` (borrar esa carpeta = empezar de cero).
