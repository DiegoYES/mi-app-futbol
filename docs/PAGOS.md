# Plan de implementación de pagos

## Producto acordado

- Una sola membresía: **$70 MXN al mes**.
- Siete días de prueba gratuita.
- Acceso completo; no habrá niveles ni funciones premium separadas.
- La landing comunica el precio, pero no cobra hasta terminar la integración.

## Decisiones implementadas

1. Proveedor: Mercado Pago Suscripciones, mediante checkout alojado.
2. La prueba de siete días no exige tarjeta; al vencer, el usuario acepta expresamente el cobro recurrente.
3. Precio público: $70 MXN mensuales, IVA incluido.
4. La cancelación detiene renovaciones y conserva el acceso hasta terminar el periodo pagado.

## Arquitectura implementada

1. El servidor crea cada suscripción recurrente por $70 MXN; el importe nunca se acepta desde el navegador.
2. Añadir una tabla/colección de suscripción con `usuario`, `proveedor`, `customer_id`, `subscription_id`, `estado`, `periodo_inicio`, `periodo_fin` y marcas de auditoría.
3. Crear un checkout alojado por el proveedor. La aplicación sólo inicia la sesión de pago y redirige.
4. Implementar un webhook firmado e idempotente. Éste será la fuente de verdad para activar, renovar, cancelar o suspender el acceso.
5. `Mi suscripción` permite consultar estado, próxima renovación y cancelar sin intervención manual.
6. Una reconciliación contra la API recupera suscripciones pendientes si un webhook se retrasa.

## Paso a producción

1. Configurar en la aplicación productiva el webhook `https://data-fut.com/webhooks/mercadopago` para Pagos y Planes y suscripciones.
2. Instalar en producción el Public Key, Access Token y secreto de webhook productivos; eliminar cualquier `MERCADOPAGO_TEST_PAYER_EMAIL`.
3. Establecer `MERCADOPAGO_ENVIRONMENT=production` y `APP_ORIGIN=https://data-fut.com`.
4. Simular una notificación productiva y exigir `200 OK` antes de habilitar cobros.
5. Promover exactamente el commit validado en staging y realizar un pago real controlado de $70 MXN.
6. Verificar alta, acceso, cancelación, conservación del periodo pagado y estado remoto antes de abrir al público.

## Seguridad y operación

- Nunca almacenar números de tarjeta, CVC ni secretos en el repositorio.
- Usar claves independientes para staging y producción.
- Verificar firma, timestamp e identificador único de cada webhook.
- Registrar transiciones de estado sin guardar cargas sensibles completas.
- Limitar e instrumentar endpoints de checkout y webhook.
- Preparar alertas para webhooks fallidos, pagos rechazados y discrepancias de estado.

## Pruebas y despliegue

1. Implementar con el modo sandbox del proveedor y usuarios exclusivos de staging.
2. Probar alta, renovación, tarjeta rechazada, reintento, cancelación, webhook duplicado y webhook fuera de orden.
3. Ejecutar smoke de navegador y pruebas de acceso vencido/activo.
4. Validar términos, privacidad, cancelación y precio final antes de habilitar el botón de cobro.
5. Promover el mismo commit validado y hacer un pago real controlado de $70 MXN en producción.

## Métricas mínimas

- Inicio y finalización de checkout.
- Conversión de prueba a pago.
- Renovaciones exitosas y rechazadas.
- Cancelaciones y motivo opcional.
- Ingreso mensual recurrente y usuarios con acceso incongruente.
