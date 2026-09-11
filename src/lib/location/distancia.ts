// Haversine client-side — só pra exibição em tela (badge dentro/fora do raio antes de tocar
// "Iniciar visita"). O backend recalcula com os mesmos dados brutos (lat/long) e é quem decide
// de fato, ver docs/02-API-BACKEND.md, regra de negócio 1.
export function calcularDistanciaMetros(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const raioTerraMetros = 6371000;
  const toRad = (graus: number) => (graus * Math.PI) / 180;

  const dLat = toRad(latitude2 - latitude1);
  const dLon = toRad(longitude2 - longitude1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latitude1)) * Math.cos(toRad(latitude2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return raioTerraMetros * c;
}
