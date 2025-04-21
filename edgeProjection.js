import {
	AmbientLight,
	Box3,
	BufferGeometry,
	Color,
	DirectionalLight,
	Float32BufferAttribute,
	Group,
	Line,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ProjectionGeneratorWorker } from './src/worker/ProjectionGeneratorWorker.js';
import { generateEdges } from './src/utils/generateEdges.js';
import { ProjectionGenerator } from './src/ProjectionGenerator.js';
import { postProcessProjection, getFilteringStats } from './src/utils/postProcessing.js';

// Create DXF Drawing class
class DxfDrawing {
	constructor() {
		this.lines = [];
	}

	addLine(x1, y1, x2, y2) {
		this.lines.push({x1, y1, x2, y2});
	}

	toDxfString() {
		let dxf = [];
		
		// Header
		dxf.push(
			'0\nSECTION\n',
			'2\nHEADER\n',
			'9\n$ACADVER\n1\nAC1009\n',
			'0\nENDSEC\n',
			'0\nSECTION\n',
			'2\nTABLES\n',
			'0\nTABLE\n',
			'2\nLAYER\n',
			'70\n1\n',
			'0\nLAYER\n',
			'2\n0\n',
			'70\n0\n',
			'62\n7\n',
			'6\nCONTINUOUS\n',
			'0\nENDTAB\n',
			'0\nENDSEC\n',
			'0\nSECTION\n',
			'2\nENTITIES\n'
		);

		// Add all lines
		this.lines.forEach(line => {
			dxf.push(
				'0\nLINE\n',
				'8\n0\n',
				`10\n${line.x1.toFixed(6)}\n`,
				`20\n${line.y1.toFixed(6)}\n`,
				'30\n0\n',
				`11\n${line.x2.toFixed(6)}\n`,
				`21\n${line.y2.toFixed(6)}\n`,
				'31\n0\n'
			);
		});

		// Footer
		dxf.push(
			'0\nENDSEC\n',
			'0\nEOF\n'
		);

		return dxf.join('');
	}
}

const params = {
	displayModel: 'color',
	displayEdges: false,
	displayProjection: true,
	sortEdges: false,
	includeIntersectionEdges: true,
	useWorker: false,
	// Camera controls
	cameraFOV: 75,
	// Model scale control
	modelScale: 1.0,
	// Edge color control
	edgeColor: '#000000',
	edgeOpacity: 0.9,
	edgeWidth: 2,
	// Projection axis
	projectionAxis: 'Y',
	// Post-processing options with optimized defaults
	enablePostProcessing: true,
	showFilteringStats: true,
	minLineLength: 0.2, // Increased threshold to filter out more small lines
	minConnections: 2,  // Increased to filter out more isolated lines
	enableSmoothing: true,
	smoothingTolerance: 0.2, // Increased for faster processing
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
	},
	// Add DXF export parameters
	dxfScale: 1.0,
	dxfUnits: 'MM',
	exportDXF: () => {
		if (projection && projection.geometry) {
			generateAndDownloadDXF();
		} else {
			console.warn('No projection geometry available to export');
		}
	}
};

const ANGLE_THRESHOLD = 50;
let renderer, camera, scene, gui, controls;
let lines, model, projection, group, shadedWhiteModel, whiteModel;
let outputContainer;
let task = null;

init();

async function init() {
	outputContainer = document.getElementById('output');

	const bgColor = 0xffffff;

	// renderer setup
	renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(bgColor, 1);
	document.body.appendChild(renderer.domElement);

	// scene setup
	scene = new Scene();
	scene.background = new Color(bgColor);

	// camera setup - adjusted for horizontal view
	camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(5, 5, 5); // Position camera to view model from an isometric angle
	camera.lookAt(0, 0, 0);

	// lights
	const light = new DirectionalLight(0xffffff, 3.5);
	light.position.set(1, 2, 3);
	scene.add(light);
	scene.add(new AmbientLight(0xb0bec5, 0.5));

	// load model
	group = new Group();
	scene.add(group);

	// Use custom model URL if available, otherwise use the default URL
	const modelUrl = window.customModelUrl || './drill_10mm_100mm.glb';

	const gltf = await new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(modelUrl);
	
	model = gltf.scene;

	// Rotate model to horizontal orientation
	model.rotation.x = -Math.PI / 2; // Rotate 90 degrees around X axis to make it horizontal

	// Create materials and model variants
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

	// Center and position the model
	const box = new Box3();
	box.setFromObject(model, true);
	const center = box.getCenter(new Vector3());
	const size = box.getSize(new Vector3());
	
	// Position model above the XZ plane
	group.position.set(-center.x, -center.y + size.y/2, -center.z);
	group.add(model, shadedWhiteModel, whiteModel);
	group.updateMatrixWorld(true);

	// Create projection display mesh
	projection = new LineSegments(
		new BufferGeometry(),
		new LineBasicMaterial({
			color: params.edgeColor,
			linewidth: params.edgeWidth,
			opacity: params.edgeOpacity,
			transparent: true
		})
	);
	
	// Position projection below the model
	projection.position.y = -size.y; // Move projection below the model
	scene.add(projection);

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

	// controls setup
	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.1;
	controls.rotateSpeed = 0.8;
	controls.panSpeed = 0.8;
	controls.zoomSpeed = 1.2;
	controls.screenSpacePanning = true;
	controls.minDistance = 0.1;
	controls.maxDistance = 1000;
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

	// Add DXF export folder
	const exportFolder = gui.addFolder('Export DXF');
	exportFolder.add(params, 'dxfScale', 0.001, 10).name('DXF Scale');
	exportFolder.add(params, 'dxfUnits', ['MM', 'CM', 'M', 'IN']).name('DXF Units');
	exportFolder.add(params, 'exportDXF').name('Export DXF');
	exportFolder.open();

	// Add post-processing controls to GUI
	const postProcessingFolder = gui.addFolder('Post Processing');
	postProcessingFolder.add(params, 'enablePostProcessing').name('Enable Filtering').onChange(() => {
		task = updateEdges();
	});
	postProcessingFolder.add(params, 'showFilteringStats').name('Show Stats');
	postProcessingFolder.add(params, 'minLineLength', 0.01, 1.0).name('Min Line Length').onChange(() => {
		task = updateEdges();
	});
	postProcessingFolder.add(params, 'minConnections', 0, 4).step(1).name('Min Connections').onChange(() => {
		task = updateEdges();
	});
	postProcessingFolder.add(params, 'enableSmoothing').name('Enable Smoothing').onChange(() => {
		task = updateEdges();
	});
	postProcessingFolder.add(params, 'smoothingTolerance', 0.01, 1.0).name('Smoothing Tolerance').onChange(() => {
		task = updateEdges();
	});
	postProcessingFolder.open();

	task = updateEdges();

	render();

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	// Update the file upload event listener in init()
	// Find the existing init() function and add this after the GUI setup:
	document.getElementById('modelFile').addEventListener('change', async function(event) {
		if (this.files.length > 0) {
			const file = this.files[0];
			window.customModelUrl = URL.createObjectURL(file);
			window.fileType = file.name.toLowerCase().endsWith('.stl') ? 'stl' : 'glb';
			
			// Update status
			document.getElementById('modelStatus').innerText = `Loading: ${file.name}`;
			
			// Reload the scene with the new model
			await reloadScene();
		}
	});

}

function* updateEdges(runTime = 60) { // Increased runtime per chunk
	const startTime = performance.now();
	outputContainer.innerText = 'Starting processing...';

	// transform and merge geometries to project into a single model
	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix(true, true);
	model.traverse(c => {
		if (c.geometry) {
			const clone = c.geometry.clone();
			clone.applyMatrix4(c.matrixWorld);
			for (const key in clone.attributes) {
				if (key !== 'position') {
					clone.deleteAttribute(key);
				}
			}
			geometries.push(clone);
		}
	});
	const mergedGeometry = mergeBufferGeometries(geometries, false);
	const mergeTime = window.performance.now() - timeStart;

	outputContainer.innerText = 'Merged geometries: ' + mergeTime.toFixed(1) + 'ms';
	yield;

	if (params.includeIntersectionEdges) {
		outputContainer.innerText = 'processing: finding edge intersections...';
		projection.geometry.dispose();
		projection.geometry = new BufferGeometry();
	}

	// generate the candidate edges
	timeStart = window.performance.now();

	let geometry = null;
	if (!params.useWorker) {
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

		const task = generator.generate(mergedGeometry, {
			onProgress: (p, data) => {
				outputContainer.innerText = `processing: ${parseFloat((p * 100).toFixed(2))}%`;
				if (params.displayProjection && data.getLineGeometry) {
					projection.geometry.dispose();
					projection.geometry = data.getLineGeometry(0, params.projectionAxis);
				}
			},
		});

		let result = task.next();
		while (!result.done) {
			result = task.next();
			yield;
		}

		geometry = result.value;

	} else {
		try {
			worker.generate(mergedGeometry, {
				sortEdges: params.sortEdges,
				includeIntersectionEdges: params.includeIntersectionEdges,
				projectionAxis: params.projectionAxis,
				projectionVector: (() => {
					switch (params.projectionAxis) {
						case 'X': return [1, 0, 0];
						case 'Y': return [0, 1, 0];
						case 'Z': return [0, 0, 1];
						default: return [0, 1, 0];
					}
				})(),
				onProgress: p => {
					outputContainer.innerText = `processing: ${parseFloat((p * 100).toFixed(2))}%`;
				}
			}).then(result => {
				geometry = result;
			}).catch(error => {
				console.error('Worker error:', error);
				params.useWorker = false; // Fallback to non-worker mode
				task = updateEdges(runTime);
			});

			while (geometry === null) {
			yield;
			}
		} catch (error) {
			console.error('Worker initialization error:', error);
			params.useWorker = false; // Fallback to non-worker mode
			return updateEdges(runTime);
		}
	}

	const trimTime = window.performance.now() - timeStart;

	// Create a new geometry for the projection
	let projectionGeometry = new BufferGeometry();
	if (geometry && geometry.getLineGeometry) {
		projectionGeometry = geometry.getLineGeometry(0, params.projectionAxis);
	} else if (geometry && geometry.attributes && geometry.attributes.position) {
		projectionGeometry.setAttribute('position', geometry.attributes.position.clone());
	}

	// Apply post-processing if enabled
	if (params.enablePostProcessing && projectionGeometry.attributes.position) {
		outputContainer.innerText = 'Applying post-processing filters...';
		const originalPositions = projectionGeometry.attributes.position.array;
		
		// Show initial line count
		if (params.showFilteringStats) {
			const initialStats = getFilteringStats(originalPositions, originalPositions);
			outputContainer.innerText = `Initial line count: ${initialStats.originalLineCount}`;
		}
		
		const filteredPositions = postProcessProjection(originalPositions, {
			minLineLength: params.minLineLength,
			minConnections: params.minConnections,
			enableSmoothing: params.enableSmoothing,
			smoothingTolerance: params.smoothingTolerance
		});
		
		if (params.showFilteringStats) {
			const stats = getFilteringStats(originalPositions, filteredPositions);
			const totalTime = (performance.now() - startTime).toFixed(1);
			outputContainer.innerText = 
				`Processing complete (${totalTime}ms)\n` +
				`Original lines: ${stats.originalLineCount}\n` +
				`Filtered lines: ${stats.filteredLineCount}\n` +
				`Reduction: ${stats.reductionPercent}%`;
			console.log(`Processing stats:`, stats);
		}
		
		projectionGeometry.setAttribute('position', new Float32BufferAttribute(filteredPositions, 3));
	}

	projection.geometry.dispose();
	projection.geometry = projectionGeometry;
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

async function loadModel(url, fileType) {
	if (fileType === 'stl') {
		const loader = new STLLoader();
		const geometry = await loader.loadAsync(url);
		const material = new MeshStandardMaterial({
			color: 0x808080,
			metalness: 0.5,
			roughness: 0.5
		});
		const mesh = new Mesh(geometry, material);
		const modelGroup = new Group();
		modelGroup.add(mesh);
		return { scene: modelGroup };
	} else {
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
		return await loader.loadAsync(url);
	}
}

async function reloadScene() {
	try {
		// Clear existing model and related objects
		if (group) {
			while (group.children.length > 0) {
				const child = group.children[0];
				if (child.geometry) child.geometry.dispose();
				if (child.material) child.material.dispose();
				group.remove(child);
			}
		}

		const modelUrl = window.customModelUrl || './drill_10mm_100mm.glb';
		const fileType = window.fileType || 'glb';
		const gltf = await loadModel(modelUrl, fileType);

		if (fileType === 'stl') {
			model = gltf.scene;
		} else {
			model = gltf.scene;
		}

		// Rotate model to horizontal orientation
		model.rotation.x = -Math.PI / 2;

		// Create white materials
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

		// Center and position the model
		const modelBounds = new Box3();
		modelBounds.setFromObject(model, true);
		const modelCenter = modelBounds.getCenter(new Vector3());
		const modelSize = modelBounds.getSize(new Vector3());
		
		// Position model above the XZ plane
		group.position.set(-modelCenter.x, -modelCenter.y + modelSize.y/2, -modelCenter.z);
		group.add(model, shadedWhiteModel, whiteModel);

		// Clear existing lines
		if (lines) {
			lines.clear();
		} else {
			lines = new Group();
			group.add(lines);
		}

		// Generate new line segments
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

		// Update status
		const statusElement = document.getElementById('modelStatus');
		if (statusElement) {
			statusElement.innerText = window.customModelUrl ? 'Custom model loaded' : 'Default model loaded';
		}

		// Generate new projection
		task = updateEdges();

		// Update projection position
		projection.position.y = -modelSize.y;

	} catch (error) {
		console.error('Error loading model:', error);
		const statusElement = document.getElementById('modelStatus');
		if (statusElement) {
			statusElement.innerText = 'Error loading model: ' + error.message;
		}
	}
}

function generateAndDownloadDXF() {
	if (!projection) {
		console.warn('No projection available');
		return;
	}

	const dxf = new DxfDrawing();
	
	// Get the current world matrix of the projection
	projection.updateWorldMatrix(true, false);
	const matrix = projection.matrixWorld;
	
	// Get the geometry directly from the projection object
	const geometry = projection.geometry;
	if (!geometry || !geometry.attributes || !geometry.attributes.position) {
		console.warn('No valid geometry in projection');
		return;
	}

	const positions = geometry.attributes.position.array;
	
	// Find bounds of the visible projection
	let minX = Infinity, minY = Infinity;
	let maxX = -Infinity, maxY = -Infinity;
	
	// Store all transformed points for consistent scaling
	const transformedPoints = [];
	
	// First pass: transform points and find bounds
	for (let i = 0; i < positions.length; i += 3) {
		// Get the point in world space
		const vector = new Vector3(
			positions[i],
			positions[i + 1],
			positions[i + 2]
		).applyMatrix4(matrix);
		
		// Project based on the selected axis
		let x, y;
		switch (params.projectionAxis) {
			case 'X':
				// For X projection, use Z as horizontal (x) and Y as vertical (y)
				x = vector.z;
				y = vector.y;
				break;
			case 'Y':
				// For Y projection, use X as horizontal (x) and Z as vertical (y)
				x = vector.x;
				y = vector.z;
				break;
			case 'Z':
			default:
				// For Z projection, use X as horizontal (x) and Y as vertical (y)
				x = vector.x;
				y = vector.y;
				break;
		}
		
		transformedPoints.push({x, y});
		
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	
	// Calculate dimensions
	const width = maxX - minX;
	const height = maxY - minY;
	
	// Determine if we need to rotate the projection to make it horizontal
	const shouldRotate = height > width;
	
	// Use model scale directly
	const scale = params.dxfScale;
	
	// Center at origin
	const offsetX = -minX * scale;
	const offsetY = -minY * scale;
	
	console.log(`Model dimensions before rotation: Width = ${width.toFixed(2)} units, Height = ${height.toFixed(2)} units`);
	console.log(`Rotating projection: ${shouldRotate ? 'Yes' : 'No'}`);
	
	// Second pass: add lines using stored transformed points
	for (let i = 0; i < transformedPoints.length - 1; i += 2) {
		const start = transformedPoints[i];
		const end = transformedPoints[i + 1];
		
		// Apply scale and offset
		let x1, y1, x2, y2;
		
		if (shouldRotate) {
			// Rotate 90 degrees counterclockwise and scale
			x1 = start.y * scale + offsetY;
			y1 = -start.x * scale - offsetX;
			x2 = end.y * scale + offsetY;
			y2 = -end.x * scale - offsetX;
		} else {
			// Normal orientation
			x1 = start.x * scale + offsetX;
			y1 = start.y * scale + offsetY;
			x2 = end.x * scale + offsetX;
			y2 = end.y * scale + offsetY;
		}
		
		// Add line to DXF
		dxf.addLine(x1, y1, x2, y2);
	}
	
	// Generate DXF content
	const dxfString = dxf.toDxfString();
	
	// Create and download the file
	const blob = new Blob([dxfString], { type: 'application/dxf' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	const dimensions = shouldRotate ? 
		`${Math.round(height)}_x_${Math.round(width)}` : 
		`${Math.round(width)}_x_${Math.round(height)}`;
	a.download = `projection_${params.projectionAxis}_axis_${dimensions}.dxf`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	
	console.log(`DXF export complete: ${dxf.lines.length} lines exported`);
	console.log(`Scale factor used: ${scale}`);
	console.log(`Final dimensions: ${shouldRotate ? 'Width = ' + height.toFixed(2) : 'Width = ' + width.toFixed(2)}, ${shouldRotate ? 'Height = ' + width.toFixed(2) : 'Height = ' + height.toFixed(2)}`);
}
