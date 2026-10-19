import { obtenerCorrelacion } from './auditoria.js'

Deno.test('conserva un correlation_id UUID enviado por el cliente', () => {
  const id = 'a0b1c2d3-e4f5-4123-8abc-1234567890ab'
  if (obtenerCorrelacion(new Request('https://example.test', { headers: { 'x-correlation-id': id } })) !== id) {
    throw new Error('debe conservar el identificador válido')
  }
})

Deno.test('reemplaza correlation_id inválido por un UUID seguro', () => {
  const id = obtenerCorrelacion(new Request('https://example.test', { headers: { 'x-correlation-id': 'no-confiable' } }))
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('debe generar un UUID para valores inválidos')
  }
})
