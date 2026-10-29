import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/geo.js', import.meta.url), 'utf8');
const { polygonAreaHa, validatePolygon, polygonReferencePoint } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const square = { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] };

test('geodesic area of a known equatorial square is returned in hectares', () => {
  // 0.01 degree latitude/longitude at the equator: approximately 1.23643 km².
  assert.ok(Math.abs(polygonAreaHa(square) - 123.643) < 0.01);
  assert.equal(validatePolygon(square), square);
  const reverse = { ...square, coordinates: [square.coordinates[0].slice().reverse()] };
  assert.ok(Math.abs(polygonAreaHa(reverse) - polygonAreaHa(square)) < 1e-8);
});

test('crossing edges are rejected rather than saved as a field', () => {
  const bowTie = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]] };
  assert.throws(() => validatePolygon(bowTie), /crosses itself/);
});

test('invalid coordinates, unclosed rings and degenerate shapes are rejected', () => {
  assert.throws(() => validatePolygon({ type: 'Point', coordinates: [0, 0] }), /Polygon/);
  assert.throws(() => validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [181, 0], [0, 1], [0, 0]]] }), /valid vertices/);
  assert.throws(() => validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), /closed final point/);
  assert.throws(() => validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] }), /too small/);
  assert.throws(() => validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [NaN, 0], [0, 1], [0, 0]]] }), /valid vertices/);
});

test('dateline-spanning fields keep their reference point at the dateline', () => {
  const geometry = { type: 'Polygon', coordinates: [[[179.99, 0], [-179.99, 0], [-179.99, 0.01], [179.99, 0.01], [179.99, 0]]] };
  const reference = polygonReferencePoint(geometry);
  assert.ok(Math.abs(Math.abs(reference.lon) - 180) < 1e-8);
  assert.equal(reference.lat, 0.005);
  assert.ok(Math.abs(polygonAreaHa(geometry) - polygonAreaHa(square) * 2) < 1e-6);
});
