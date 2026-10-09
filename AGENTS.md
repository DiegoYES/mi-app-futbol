# Reglas Operativas del Repositorio: mi-app-futbol

## Concurrencia y Comandos Git
- **Regla permanente:** Un solo escritor Git a la vez en este repositorio.
- **Prohibición de Git autónomo:** Nunca ejecutar `git add`, `git commit`, `git pull`, `git push`, `git checkout`, `git reset` de forma automática, ni en segundo plano, ni en tareas programadas/loops. Solo ejecutarlos bajo petición explícita del usuario.
- **Protocolo de ejecución para comandos Git de escritura:**
  Antes de cualquier comando Git de escritura (`add`, `commit`, `pull`, `push`, `stash`, `checkout`, `reset`, `gc`):
  1. Verificar que no haya otro proceso `git` corriendo: `pgrep -f "git "`.
  2. Si lo hay, esperar y reintentar hasta 30 segundos (con sleep 1s). Nunca lanzar comandos en paralelo.
  3. Ejecutar siempre usando cerrojo exclusivo:
     `flock /tmp/mi-app-futbol-git.lock git <comando>`
