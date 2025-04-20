import {
	BufferGeometry,
	Vector3,
	Line3,
	Ray,
	BufferAttribute,
} from 'https://unpkg.com/three@0.136.0/build/three.module.js';
import { MeshBVH } from 'https://unpkg.com/three-mesh-bvh@0.5.19/build/index.module.js';
import {
	isYProjectedTriangleDegenerate,
	isLineTriangleEdge,
	isYProjectedLineDegenerate,
	isProjectedTriangleDegenerate,
	isProjectedLineDegenerate,
} from './utils/triangleLineUtils.js';
import { generateEdges } from './utils/generateEdges.js';
import { compressEdgeOverlaps, overlapsToLines } from './utils/overlapUtils.js';
import { trimToBeneathTriPlane } from './utils/trimToBeneathTriPlane.js';
import { getProjectedLineOverlap } from './utils/getProjectedLineOverlap.js';
import { appendOverlapRange } from './utils/getProjectedOverlaps.js';
import { generateIntersectionEdges } from './utils/generateIntersectionEdges.js';

// these shared variables are not used across "yield" boundaries in the
// generator so there's no risk of overwriting another tasks data
const DIST_THRESHOLD = 1e-10;
const _beneathLine = /* @__PURE__ */ new Line3();
const _ray = /* @__PURE__ */ new Ray();
const _vec = /* @__PURE__ */ new Vector3();
const _overlapLine = /* @__PURE__ */ new Line3();

class EdgeSet {

	constructor() {

		this.edges = [];

	}

	getLineGeometry( projectionValue = 0, projectionAxis = 'Y' ) {

		const edges = this.edges;
		const edgeArray = new Float32Array( edges.length * 6 );
		let c = 0;
		
		// Set coordinates based on projection axis
		for ( let i = 0, l = edges.length; i < l; i ++ ) {
			const line = edges[ i ];
			
			switch (projectionAxis) {
				case 'X':
					// Project onto YZ plane
					edgeArray[ c ++ ] = projectionValue;
					edgeArray[ c ++ ] = line[ 1 ];
					edgeArray[ c ++ ] = line[ 2 ];
					edgeArray[ c ++ ] = projectionValue;
					edgeArray[ c ++ ] = line[ 4 ];
					edgeArray[ c ++ ] = line[ 5 ];
					break;
				case 'Z':
					// Project onto XY plane
					edgeArray[ c ++ ] = line[ 0 ];
					edgeArray[ c ++ ] = line[ 1 ];
					edgeArray[ c ++ ] = projectionValue;
					edgeArray[ c ++ ] = line[ 3 ];
					edgeArray[ c ++ ] = line[ 4 ];
					edgeArray[ c ++ ] = projectionValue;
					break;
				case 'Y':
				default:
					// Project onto XZ plane (original behavior)
					edgeArray[ c ++ ] = line[ 0 ];
					edgeArray[ c ++ ] = projectionValue;
					edgeArray[ c ++ ] = line[ 2 ];
					edgeArray[ c ++ ] = line[ 3 ];
					edgeArray[ c ++ ] = projectionValue;
					edgeArray[ c ++ ] = line[ 5 ];
					break;
			}
		}

		const edgeGeom = new BufferGeometry();
		const edgeBuffer = new BufferAttribute( edgeArray, 3, true );
		edgeGeom.setAttribute( 'position', edgeBuffer );
		return edgeGeom;

	}

}

export class ProjectionGenerator {

	constructor() {

		this.sortEdges = true;
		this.iterationTime = 30;
		this.angleThreshold = 50;
		this.includeIntersectionEdges = true;
		this.projectionVector = new Vector3(0, 1, 0); // Default to Y axis (UP_VECTOR)

	}

	generateAsync( geometry, options = {} ) {

		return new Promise( ( resolve, reject ) => {

			const { signal } = options;
			const task = this.generate( geometry, options );
			run();

			function run() {

				if ( signal && signal.aborted ) {

					reject( new Error( 'ProjectionGenerator: Process aborted via AbortSignal.' ) );
					return;

				}

				const result = task.next();
				if ( result.done ) {

					resolve( result.value );

				} else {

					requestAnimationFrame( run );

				}

			}

		} );

	}

	*generate( bvh, options = {} ) {

		const { onProgress } = options;
		const { sortEdges, iterationTime, angleThreshold, includeIntersectionEdges, projectionVector } = this;

		if ( bvh instanceof BufferGeometry ) {

			bvh = new MeshBVH( bvh, { maxLeafTris: 1 } );

		}

		// find the set of edges of intersecting triangles
		const geometry = bvh.geometry;
		let edges = generateEdges( geometry, projectionVector, angleThreshold );
		if ( includeIntersectionEdges ) {

			const results = yield* generateIntersectionEdges( bvh, iterationTime, projectionVector );
			edges = edges.concat( results );

		}

		// sort the edges from lowest to highest based on projection vector
		if ( sortEdges ) {
			// Determine which component to sort on based on the largest component of projectionVector
			const absX = Math.abs(projectionVector.x);
			const absY = Math.abs(projectionVector.y);
			const absZ = Math.abs(projectionVector.z);
			
			if (absX >= absY && absX >= absZ) {
				// X is dominant
				edges.sort( ( a, b ) => {
					return Math.min( a.start.x, a.end.x ) - Math.min( b.start.x, b.end.x );
				});
			} else if (absY >= absX && absY >= absZ) {
				// Y is dominant
				edges.sort( ( a, b ) => {
					return Math.min( a.start.y, a.end.y ) - Math.min( b.start.y, b.end.y );
				});
			} else {
				// Z is dominant
				edges.sort( ( a, b ) => {
					return Math.min( a.start.z, a.end.z ) - Math.min( b.start.z, b.end.z );
				});
			}
		}

		yield;

		// trim the candidate edges
		const finalEdges = new EdgeSet();
		let time = performance.now();
		for ( let i = 0, l = edges.length; i < l; i ++ ) {

			const line = edges[ i ];
			if ( isProjectedLineDegenerate( line, projectionVector ) ) {

				continue;

			}

			const lowestLineY = Math.min( line.start.y, line.end.y );
			const highestLineY = Math.max( line.start.y, line.end.y );
			const hiddenOverlaps = [];
			bvh.shapecast( {

				intersectsBounds: box => {

					// expand the bounding box to the bottom height of the line
					box.min.y = Math.min( lowestLineY - 1e-6, box.min.y );

					// get the line as a ray
					const { origin, direction } = _ray;
					origin.copy( line.start );
					line.delta( direction ).normalize();

					// if the ray is inside the box then we intersect it
					if ( box.containsPoint( origin ) ) {

						return true;

					}

					// check if the line segment intersects the box
					if ( _ray.intersectBox( box, _vec ) ) {

						return origin.distanceToSquared( _vec ) < line.distanceSq();

					}

					return false;

				},

				intersectsTriangle: tri => {

					// skip the triangle if the triangle is completely below the line
					const highestTriangleY = Math.max( tri.a.y, tri.b.y, tri.c.y );
					if ( highestTriangleY <= lowestLineY ) {

						return false;

					}

					// if the projected triangle is just a line then don't check it
					if ( isProjectedTriangleDegenerate( tri, projectionVector ) ) {

						return false;

					}

					// if this line lies on a triangle edge then don't check for visual overlaps
					// with this triangle
					if ( isLineTriangleEdge( tri, line ) ) {

						return false;

					}

					// Retrieve the portion of line that is below the plane - and skip the triangle if none
					// of it is
					const lowestTriangleY = Math.min( tri.a.y, tri.b.y, tri.c.y );
					if ( highestLineY < lowestTriangleY ) {
						_beneathLine.copy( line );
					} else if ( ! trimToBeneathTriPlane( tri, line, _beneathLine, projectionVector ) ) {
						return false;
					}

					// Cull overly small edges
					if ( _beneathLine.distance() < DIST_THRESHOLD ) {

						return false;

					}

					// compress the edge overlaps so we can easily tell if the whole edge is hidden already
					// and exit early
					if (
						getProjectedLineOverlap( _beneathLine, tri, _overlapLine, projectionVector ) &&
						appendOverlapRange( line, _overlapLine, hiddenOverlaps )
					) {
						compressEdgeOverlaps( hiddenOverlaps );
					}

					// if we're hiding the edge entirely now then skip further checks
					if ( hiddenOverlaps.length !== 0 ) {

						const [ d0, d1 ] = hiddenOverlaps[ hiddenOverlaps.length - 1 ];
						return d0 === 0.0 && d1 === 1.0;

					}

					return false;

				},

			} );

			// convert the overlap points to proper lines
			overlapsToLines( line, hiddenOverlaps, finalEdges.edges );

			const delta = performance.now() - time;
			if ( delta > iterationTime ) {

				if ( onProgress ) {

					const progress = i / edges.length;
					onProgress( progress, finalEdges );

				}

				yield;
				time = performance.now();

			}

		}

		return finalEdges;

	}

}
