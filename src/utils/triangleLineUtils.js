import { Vector3 } from 'https://cdn.skypack.dev/three@0.136.0';

const EPSILON = 1e-16;
const DEFAULT_UP_VECTOR = /* @__PURE__ */ new Vector3(0, 1, 0);
const _dir = new Vector3();

export function isYProjectedLineDegenerate(line, projectionVector = DEFAULT_UP_VECTOR) {
	line.delta(_dir).normalize();
	return Math.abs(_dir.dot(projectionVector)) >= 1.0 - EPSILON;
}

// Generic function that works with any projection vector
export function isProjectedLineDegenerate(line, projectionVector = DEFAULT_UP_VECTOR) {
	return isYProjectedLineDegenerate(line, projectionVector);
}

// checks whether the projected triangle will be degenerate along projection vector
export function isYProjectedTriangleDegenerate(tri, projectionVector = DEFAULT_UP_VECTOR) {
	if (tri.needsUpdate) {
		tri.update();
	}
	return Math.abs(tri.plane.normal.dot(projectionVector)) <= EPSILON;
}

// Generic function that works with any projection vector
export function isProjectedTriangleDegenerate(tri, projectionVector = DEFAULT_UP_VECTOR) {
	return isYProjectedTriangleDegenerate(tri, projectionVector);
}

// Is the provided line exactly an edge on the triangle
export function isLineTriangleEdge(tri, line) {
	// if this is the same line as on the triangle
	const { start, end } = line;
	const triPoints = tri.points;
	let startMatches = false;
	let endMatches = false;
	for (let i = 0; i < 3; i++) {
		const tp = triPoints[i];
		if (!startMatches && start.distanceToSquared(tp) <= EPSILON) {
			startMatches = true;
		}
		if (!endMatches && end.distanceToSquared(tp) <= EPSILON) {
			endMatches = true;
		}
		if (startMatches && endMatches) {
			return true;
		}
	}
	return startMatches && endMatches;
}
