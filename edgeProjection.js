import {
	Box3,
	WebGLRenderer,
	Scene,
	DirectionalLight,
	AmbientLight,
	Group,
	MeshStandardMaterial,
	MeshBasicMaterial,
	BufferGeometry,
	LineSegments,
	LineBasicMaterial,
	PerspectiveCamera,
	Vector3,
	Sphere
} from 'https://unpkg.com/three@0.136.0/build/three.module.js';
import { GUI } from 'https://unpkg.com/three@0.136.0/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'https://unpkg.com/three@0.136.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.136.0/examples/jsm/loaders/GLTFLoader.js';
import { mergeBufferGeometries } from 'https://unpkg.com/three@0.136.0/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'https://unpkg.com/three@0.136.0/examples/jsm/libs/meshopt_decoder.module.js';
import { ProjectionGenerator } from './src/ProjectionGenerator.js';
import { ProjectionGeneratorWorker } from './src/worker/ProjectionGeneratorWorker.js';
import { generateEdges } from './src/utils/generateEdges.js';

const params = {
	displayModel: 'color',
	displayEdges: false,
	displayProjection: true,
	sortEdges: true,
	includeIntersectionEdges: true,
	useWorker: false,
	// New camera controls
	cameraFOV: 75,
	// Model scale control
	modelScale: 1.0,
	// Edge color control
	edgeColor: '#ffffff',
	edgeOpacity: 0.9,
	edgeWidth: 2,
	// Projection axis
	projectionAxis: 'Y', // can be 'X', 'Y', or 'Z'
	// Toggle projection
	toggleProjection: () => {
		params.displayProjection = !params.displayProjection;
		projection.visible = params.displayProjection;
	},
	resetCamera: () => {
		camera.position.set(0, 3.5, 3.5);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		controls.target.set(0, 0, 0);
		controls.update();
	},
	// Enhanced rotate function
	rotate: () => {
		group.quaternion.random();
		group.position.set( 0, 0, 0 );
		group.updateMatrixWorld( true );

		const box = new Box3();
		box.setFromObject( model, true );
		box.getCenter( group.position ).multiplyScalar( - 1 );
		group.position.y = Math.max( 0, - box.min.y ) + 1;
	},
	regenerate: () => {
		task = updateEdges();
	},
	// Scale model function
	scaleModel: () => {
		group.scale.set(params.modelScale, params.modelScale, params.modelScale);
		
		// Recenter after scaling
		const box = new Box3();
		box.setFromObject(model, true);
		box.getCenter(group.position).multiplyScalar(-1);
		group.position.y = Math.max(0, -box.min.y) + 1;
		
		// Adjust camera to model size after scaling
		const finalBox = new Box3().setFromObject(group);
		const modelRadius = finalBox.getBoundingSphere(new Sphere()).radius;
		
		// Update camera near/far planes
		camera.near = modelRadius * 0.01;
		camera.far = modelRadius * 100;
		camera.updateProjectionMatrix();
		
		// Update controls limits based on model size
		controls.minDistance = modelRadius * 0.1;
		controls.maxDistance = modelRadius * 10;
		controls.update();
		
		// Update the output info
		if (outputContainer) {
			outputContainer.innerText = `Model scale: ${params.modelScale.toFixed(4)}\nModel radius: ${modelRadius.toFixed(2)} units`;
		}
		
		// Regenerate edges
		task = updateEdges();
	},
	// Update edge appearance
	updateEdgeAppearance: () => {
		if (projection && projection.material) {
			projection.material.color.set(params.edgeColor);
			projection.material.opacity = params.edgeOpacity;
			projection.material.linewidth = params.edgeWidth;
			projection.material.needsUpdate = true;
		}
	}
};

const ANGLE_THRESHOLD = 50;
let renderer, camera, scene, gui, controls;
let lines, model, projection, group, shadedWhiteModel, whiteModel;
let outputContainer;
let worker;
let task = null;

init();

async function init() {

	outputContainer = document.getElementById( 'output' );

	const bgColor = 0xeeeeee;

	// renderer setup
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new Scene();

	// lights
	const light = new DirectionalLight( 0xffffff, 3.5 );
	light.position.set( 1, 2, 3 );
	scene.add( light );

	const ambientLight = new AmbientLight( 0xb0bec5, 0.5 );
	scene.add( ambientLight );

	// load model
	group = new Group();
	scene.add( group );

	// Use custom model URL if available, otherwise use the default URL
	const modelUrl = window.customModelUrl || './drill_10mm_100mm.glb';
	
	const gltf = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( modelUrl );
	
	model = gltf.scene;

	const whiteMaterial = new MeshStandardMaterial( {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	} );
	shadedWhiteModel = model.clone();
	shadedWhiteModel.traverse( c => {

		if ( c.material ) {

			c.material = whiteMaterial;

		}

	} );

	const whiteBasicMaterial = new MeshBasicMaterial( {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	} );
	whiteModel = model.clone();
	whiteModel.traverse( c => {

		if ( c.material ) {

			c.material = whiteBasicMaterial;

		}

	} );

	group.updateMatrixWorld( true );

	// center model
	const box = new Box3();
	box.setFromObject( model, true );
	box.getCenter( group.position ).multiplyScalar( - 1 );
	group.position.y = Math.max( 0, - box.min.y ) + 1;
	group.add( model, shadedWhiteModel, whiteModel );

	// generate geometry line segments
	lines = new Group();
	model.traverse( c => {

		if ( c.geometry ) {

			const edges = generateEdges( c.geometry, undefined, ANGLE_THRESHOLD );
			const points = edges.flatMap( line => [ line.start, line.end ] );
			const geom = new BufferGeometry();
			geom.setFromPoints( points );

			const geomLines = new LineSegments( geom, new LineBasicMaterial( { color: 0x030303 } ) );
			geomLines.position.copy( c.position );
			geomLines.quaternion.copy( c.quaternion );
			geomLines.scale.copy( c.scale );
			lines.add( geomLines );

		}

	} );
	group.add( lines );

	// create projection display mesh with thicker lines for better visibility
	projection = new LineSegments(
		new BufferGeometry(), 
		new LineBasicMaterial({ 
			color: params.edgeColor,
			linewidth: params.edgeWidth,
			opacity: params.edgeOpacity,
			transparent: true
		})
	);
	scene.add(projection);

	// camera setup
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 50 );
	camera.position.setScalar( 3.5 );
	camera.updateProjectionMatrix();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.rotateSpeed = 0.8;
	controls.panSpeed = 0.8;
	controls.zoomSpeed = 1.2;
	controls.screenSpacePanning = true;
	controls.minDistance = 0.1; // Reduce min distance for large models
	controls.maxDistance = 100; // Increase max distance for large models
	controls.maxPolarAngle = Math.PI * 0.9;

	gui = new GUI();
	const displayFolder = gui.addFolder('Display');
	displayFolder.add( params, 'displayModel', [
		'none',
		'color',
		'shaded white',
		// 'white',
	] );
	// displayFolder.add( params, 'displayEdges' );
	displayFolder.add( params, 'displayProjection' );
	displayFolder.open();
	
	const processingFolder = gui.addFolder('Processing');
	processingFolder.add( params, 'sortEdges' );
	processingFolder.add( params, 'includeIntersectionEdges' );
	processingFolder.add( params, 'useWorker' );
	processingFolder.add( params, 'regenerate' ).name('Regenerate Edges');
	processingFolder.open();
	
	const cameraFolder = gui.addFolder('Camera & Model');
	cameraFolder.add( params, 'cameraFOV', 10, 120 ).onChange(() => {
		camera.fov = params.cameraFOV;
		camera.updateProjectionMatrix();
	});
	cameraFolder.add( params, 'resetCamera' ).name('Reset Camera');
	cameraFolder.add( params, 'rotate' ).name('Random Rotation');
	// Add model scale slider
	cameraFolder.add( params, 'modelScale', 0.001, 10 ).name('Model Scale').onChange(() => {
		params.scaleModel();
	});
	// Add projection axis options
	cameraFolder.add( params, 'projectionAxis', ['X', 'Y', 'Z'] ).name('Projection Axis').onChange(() => {
		task = updateEdges();
	});
	cameraFolder.open();

	// Add edge appearance folder
	const edgeFolder = gui.addFolder('Edge Appearance');
	edgeFolder.addColor(params, 'edgeColor').name('Edge Color').onChange(params.updateEdgeAppearance);
	edgeFolder.add(params, 'edgeOpacity', 0, 1).name('Edge Opacity').onChange(params.updateEdgeAppearance);
	edgeFolder.add(params, 'edgeWidth', 1, 10).name('Edge Width').onChange(params.updateEdgeAppearance).step(1);
	edgeFolder.add(params, 'toggleProjection').name('Toggle Projection');
	edgeFolder.open();

	worker = new ProjectionGeneratorWorker();

	task = updateEdges();

	render();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

}

function* updateEdges( runTime = 30 ) {

	outputContainer.innerText = 'processing: --';

	// transform and merge geometries to project into a single model
	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix( true, true );
	model.traverse( c => {

		if ( c.geometry ) {

			const clone = c.geometry.clone();
			clone.applyMatrix4( c.matrixWorld );
			for ( const key in clone.attributes ) {

				if ( key !== 'position' ) {

					clone.deleteAttribute( key );

				}

			}

			geometries.push( clone );

		}

	} );
	const mergedGeometry = mergeBufferGeometries( geometries, false );
	const mergeTime = window.performance.now() - timeStart;

	yield;

	if ( params.includeIntersectionEdges ) {

		outputContainer.innerText = 'processing: finding edge intersections...';
		projection.geometry.dispose();
		projection.geometry = new BufferGeometry();

	}

	// generate the candidate edges
	timeStart = window.performance.now();

	let geometry = null;
	if ( ! params.useWorker ) {

		const generator = new ProjectionGenerator();
		generator.sortEdges = params.sortEdges;
		generator.iterationTime = runTime;
		generator.angleThreshold = ANGLE_THRESHOLD;
		generator.includeIntersectionEdges = params.includeIntersectionEdges;
		
		// Set up projection direction based on selected axis
		const projectionVector = new Vector3();
		switch (params.projectionAxis) {
			case 'X':
				projectionVector.set(1, 0, 0);
				break;
			case 'Y':
				projectionVector.set(0, 1, 0);
				break;
			case 'Z':
				projectionVector.set(0, 0, 1);
				break;
		}
		
		// Pass the projection vector to the generator
		generator.projectionVector = projectionVector;

		const task = generator.generate( mergedGeometry, {

			onProgress: ( p, data ) => {

				outputContainer.innerText = `processing: ${ parseFloat( ( p * 100 ).toFixed( 2 ) ) }%`;
				if ( params.displayProjection ) {

					projection.geometry.dispose();
					projection.geometry = data.getLineGeometry(0, params.projectionAxis);

				}


			},

		} );

		let result = task.next();
		while ( ! result.done ) {

			result = task.next();
			yield;

		}

		geometry = result.value;

	} else {

		worker
			.generate( mergedGeometry, {
				sortEdges: params.sortEdges,
				includeIntersectionEdges: params.includeIntersectionEdges,
				projectionAxis: params.projectionAxis,
				projectionVector: (() => {
					// Create the proper projection vector based on axis
					switch (params.projectionAxis) {
						case 'X': return [1, 0, 0];
						case 'Y': return [0, 1, 0];
						case 'Z': return [0, 0, 1];
						default: return [0, 1, 0];
					}
				})(),
				onProgress: p => {

					outputContainer.innerText = `processing: ${ parseFloat( ( p * 100 ).toFixed( 2 ) ) }%`;

				},
			} )
			.then( result => {

				geometry = result;

			} );

		while ( geometry === null ) {

			yield;

		}

	}

	const trimTime = window.performance.now() - timeStart;

	projection.geometry.dispose();
	projection.geometry = geometry.getLineGeometry(0, params.projectionAxis);
	outputContainer.innerText =
		`merge geometry  : ${ mergeTime.toFixed( 2 ) }ms\n` +
		`edge trimming   : ${ trimTime.toFixed( 2 ) }ms`;

}


function render() {

	requestAnimationFrame( render );

	if ( task ) {

		const res = task.next();
		if ( res.done ) {

			task = null;
			// Ensure projection is visible after task completes
			projection.visible = params.displayProjection;

		}

	}

	model.visible = params.displayModel === 'color';
	shadedWhiteModel.visible = params.displayModel === 'shaded white';
	whiteModel.visible = params.displayModel === 'white';
	lines.visible = params.displayEdges;
	
	// Make projection visibility respect the displayProjection parameter
	projection.visible = params.displayProjection;

	// Update controls for damping effect
	controls.update();

	renderer.render( scene, camera );

}

// Function to reload the scene when a new model is uploaded
window.reloadScene = async function() {
	// Clean up existing objects
	if (projection) {
		scene.remove(projection);
		projection.geometry.dispose();
	}
	
	if (group) {
		scene.remove(group);
		group = new Group();
		scene.add(group);
	}
	
	// Reinitialize
	outputContainer = document.getElementById('output');
	outputContainer.innerText = 'Loading new model...';
	
	// Use custom model URL
	const modelUrl = window.customModelUrl;
	
	try {
		const gltf = await new GLTFLoader()
			.setMeshoptDecoder(MeshoptDecoder)
			.loadAsync(modelUrl);
		
		model = gltf.scene;
		
		// Check model size and apply initial scaling for very large models
		const tempBox = new Box3().setFromObject(model);
		const modelSize = tempBox.getSize(new Vector3());
		const maxDimension = Math.max(modelSize.x, modelSize.y, modelSize.z);
		
		// If the model is very large, scale it down automatically
		if (maxDimension > 10) {
			const suggestedScale = 5 / maxDimension;
			params.modelScale = suggestedScale;
			model.scale.set(suggestedScale, suggestedScale, suggestedScale);
			outputContainer.innerText = `Model scaled to ${suggestedScale.toFixed(4)} due to large size (${maxDimension.toFixed(2)} units)`;
		}
		
		const whiteMaterial = new MeshStandardMaterial({
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
		shadedWhiteModel = model.clone();
		shadedWhiteModel.traverse(c => {
			if (c.material) {
				c.material = whiteMaterial;
			}
		});
		
		const whiteBasicMaterial = new MeshBasicMaterial({
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
		whiteModel = model.clone();
		whiteModel.traverse(c => {
			if (c.material) {
				c.material = whiteBasicMaterial;
			}
		});
		
		group.updateMatrixWorld(true);
		
		// center model
		const box = new Box3();
		box.setFromObject(model, true);
		box.getCenter(group.position).multiplyScalar(-1);
		group.position.y = Math.max(0, -box.min.y) + 1;
		group.add(model, shadedWhiteModel, whiteModel);
		
		// generate geometry line segments
		lines = new Group();
		model.traverse(c => {
			if (c.geometry) {
				const edges = generateEdges(c.geometry, undefined, ANGLE_THRESHOLD);
				const points = edges.flatMap(line => [line.start, line.end]);
				const geom = new BufferGeometry();
				geom.setFromPoints(points);
				
				const geomLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x030303 }));
				geomLines.position.copy(c.position);
				geomLines.quaternion.copy(c.quaternion);
				geomLines.scale.copy(c.scale);
				lines.add(geomLines);
			}
		});
		group.add(lines);
		
		// create projection display mesh with better visibility
		projection = new LineSegments(
			new BufferGeometry(), 
			new LineBasicMaterial({ 
				color: params.edgeColor,
				linewidth: params.edgeWidth,
				opacity: params.edgeOpacity,
				transparent: true 
			})
		);
		scene.add(projection);
		
		// Force the projection display parameter on
		params.displayProjection = true;
		
		// Position the camera based on model size
		// Get the model's bounding box again after all processing
		const finalBox = new Box3().setFromObject(group);
		const modelRadius = finalBox.getBoundingSphere(new Sphere()).radius;
		
		// Set camera position based on model radius
		camera.position.set(modelRadius*1.5, modelRadius*1.5, modelRadius*1.5);
		camera.lookAt(0, 0, 0);
		camera.near = modelRadius * 0.01;
		camera.far = modelRadius * 100;
		camera.updateProjectionMatrix();
		
		controls.target.set(0, 0, 0);
		controls.minDistance = modelRadius * 0.1;
		controls.maxDistance = modelRadius * 10;
		controls.update();
		
		// Run edge generation
		task = updateEdges();
		
		outputContainer.innerText += '\nModel loaded successfully. Generating edges...';
	} catch (error) {
		outputContainer.innerText = `Error loading model: ${error.message}`;
		console.error('Error loading model:', error);
	}
	
	// Ensure projection is visible after reload
	params.displayProjection = true;
	if (projection) projection.visible = true;
};
