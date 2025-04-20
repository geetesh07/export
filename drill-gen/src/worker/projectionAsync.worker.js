import { BufferAttribute, BufferGeometry, Vector3 } from 'https://unpkg.com/three@0.136.0/build/three.module.js';
import { ProjectionGenerator } from '../ProjectionGenerator.js';

onmessage = function ( { data } ) {

	let prevTime = performance.now();
	function onProgressCallback( progress ) {

		const currTime = performance.now();
		if ( currTime - prevTime >= 10 || progress === 1.0 ) {

			postMessage( {

				error: null,
				progress,

			} );
			prevTime = currTime;

		}

	}

	try {

		const { index, position, options } = data;
		const geometry = new BufferGeometry();
		geometry.setIndex( new BufferAttribute( index, 1, false ) );
		geometry.setAttribute( 'position', new BufferAttribute( position, 3, false ) );

		const generator = new ProjectionGenerator();
		generator.sortEdges = options.sortEdges ?? generator.sortEdges;
		generator.angleThreshold = options.angleThreshold ?? generator.angleThreshold;
		generator.includeIntersectionEdges = options.includeIntersectionEdges ?? generator.includeIntersectionEdges;
		
		// Handle projection vector if provided
		if (options.projectionVector) {
			const [x, y, z] = options.projectionVector;
			generator.projectionVector = new Vector3(x, y, z);
		}

		const task = generator.generate( geometry, {
			onProgress: onProgressCallback,
		} );

		let result = task.next();
		while ( ! result.done ) {

			result = task.next();

		}

		const resultLines = result.value.attributes.position.array;
		postMessage( {

			result: resultLines,
			error: null,
			progress: 1,

		}, [ resultLines.buffer ] );

	} catch ( error ) {

		postMessage( {

			error,
			progress: 1,

		} );

	}

};
