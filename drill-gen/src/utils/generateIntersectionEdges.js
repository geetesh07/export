import { Line3, Vector3 } from 'https://unpkg.com/three@0.136.0/build/three.module.js';
import { ExtendedTriangle } from 'https://unpkg.com/three-mesh-bvh@0.5.19/build/index.module.js';
import { isLineTriangleEdge } from './triangleLineUtils.js';

const OFFSET_EPSILON = 1e-6;
const _tri = new ExtendedTriangle();
const _line = new Line3();
const _defaultVector = new Vector3(0, 1, 0);

export function* generateIntersectionEdges( bvh, iterationTime = 30, projectionVector = _defaultVector ) {

	const edges = [];
	const geometry = bvh.geometry;
	const index = geometry.index;
	const posAttr = geometry.attributes.position;
	const vertCount = index ? index.count : posAttr;
	
	// Determine which component to offset based on the largest component of projectionVector
	const absX = Math.abs(projectionVector.x);
	const absY = Math.abs(projectionVector.y);
	const absZ = Math.abs(projectionVector.z);
	
	const offsetVector = new Vector3();
	if (absX >= absY && absX >= absZ) {
		offsetVector.set(OFFSET_EPSILON, 0, 0);
	} else if (absY >= absX && absY >= absZ) {
		offsetVector.set(0, OFFSET_EPSILON, 0);
	} else {
		offsetVector.set(0, 0, OFFSET_EPSILON);
	}

	let time = performance.now();
	for ( let i = 0; i < vertCount; i += 3 ) {

		let i0 = i + 0;
		let i1 = i + 1;
		let i2 = i + 2;
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );
			i2 = index.getX( i2 );

		}

		const { a, b, c } = _tri;
		a.fromBufferAttribute( posAttr, i0 );
		b.fromBufferAttribute( posAttr, i1 );
		c.fromBufferAttribute( posAttr, i2 );
		_tri.needsUpdate = true;
		_tri.update();

		bvh.shapecast( {

			intersectsBounds: box => {

				return box.intersectsTriangle( _tri );

			},

			intersectsTriangle: tri2 => {

				if ( _tri.equals( tri2 ) ) {

					return false;

				}

				if ( tri2.needsUpdate ) {

					tri2.update();

				}

				if ( Math.abs( _tri.plane.normal.dot( tri2.plane.normal ) ) > 1 - 1e-6 ) {

					return false;

				}

				if (
					_tri.intersectsTriangle( tri2, _line, true ) &&
					! isLineTriangleEdge( _tri, _line ) &&
					! isLineTriangleEdge( tri2, _line )
				) {

					// Apply offset in the direction of the projection vector
					_line.start.add(offsetVector);
					_line.end.add(offsetVector);
					edges.push( _line.clone() );

				}

			},

		} );

		const delta = performance.now() - time;
		if ( delta > iterationTime ) {

			yield;
			time = performance.now();

		}

	}

	return edges;

}
