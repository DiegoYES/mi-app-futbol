# Plan de implementación de pagos

## Producto acordado

- Una sola membresía: **$70 MXN al mes**.
- Siete días de prueba gratuita.
- Acceso completo; no habrá niveles ni funciones premium separadas.
- La landing comunica el precio, pero no cobra hasta terminar la integración.

## Decisiones necesarias antes de programar

1. Elegir proveedor. Para México conviene evaluar Stripe y Mercado Pago según comisión, pagos recurrentes, conciliación y soporte de tarjetas locales.
2. Definir si la prueba exige tarjeta. La recomendación inicial es no pedirla: reduce fricción, aunque baja la conversión automática.
3. Confirmar razón social, datos fiscales, descriptor bancario, políticas de cancelación, privacidad y términos.
4. Definir impuestos y comprobantes. El precio público debe aclarar si incluye IVA.

## Arquitectura propuesta

1. Crear el precio recurrente de $70 MXN en el panel del proveedor; el importe nunca se acepta desde el navegador.
2. Añadir una tabla/colección de suscripción con `usuario`, `proveedor`, `customer_id`, `subscription_id`, `estado`, `periodo_inicio`, `periodo_fin` y marcas de auditoría.
3. Crear un checkout alojado por el proveedor. La aplicación sólo inicia la sesión de pago y redirige.
4. Implementar un webhook firmado e idempotente. Éste será la fuente de verdad para activar, renovar, cancelar o suspender el acceso.
5. Añadir un portal de cliente para actualizar tarjeta, consultar pagos y cancelar sin intervención manual.
6. Mantener un periodo de gracia corto ante fallos de cobro y avisar al usuario antes de retirar acceso.

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
