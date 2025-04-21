import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateDrillGeometry } from '../lib/drillGenerator';
import { DrillParameters } from '@/types/drill';
import { Hand, Maximize, RotateCcw, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface DrillViewerProps {
  parameters: DrillParameters;
  viewMode: '3d' | '2d';
  wireframe?: boolean;
  onCameraUpdate?: (camera: THREE.Camera) => void;
}

// Improved WebGL detection that doesn't modify the THREE object
const isWebGLAvailable = () => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (e) {
    console.error("WebGL detection error:", e);
    return false;
  }
};

const DrillViewer: React.FC<DrillViewerProps> = React.memo(({ parameters, viewMode, wireframe = false, onCameraUpdate }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const drillMeshRef = useRef<THREE.Mesh | null>(null);
  const dimensionsGroupRef = useRef<THREE.Group | null>(null);
  const initializedRef = useRef<boolean>(false);
  const defaultCameraPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(30, 20, 30));
  const wheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isHandMode, setIsHandMode] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const resetView = () => {
    if (!cameraRef.current || !controlsRef.current || !parameters) return;
    
    try {
      const maxDimension = Math.max(
        parameters.length,
        parameters.diameter * 2,
        parameters.shankDiameter * 2
      );
      
      const cameraDistance = maxDimension * 1.5;
      
      // Always use 3D view mode
      cameraRef.current.position.set(
        cameraDistance * 0.7, 
        cameraDistance * 0.4, 
        cameraDistance * 0.7
      );
      controlsRef.current.target.set(0, 0, 0);
      
      controlsRef.current.update();
      defaultCameraPositionRef.current = cameraRef.current.position.clone();
      
      // Make sure to render once after reset
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    } catch (error) {
      console.error('Error in resetView:', error);
      setRenderError('Failed to reset view. Please refresh the page.');
    }
  };

  const zoomToFit = () => {
    if (!drillMeshRef.current || !cameraRef.current || !controlsRef.current) return;
    
    try {
      const boundingBox = new THREE.Box3().setFromObject(drillMeshRef.current);
      const center = new THREE.Vector3();
      boundingBox.getCenter(center);
      
      controlsRef.current.target.copy(center);
      
      const size = new THREE.Vector3();
      boundingBox.getSize(size);
      
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let distance = maxDim / (2 * Math.tan(fov / 2));
      
      // Add padding to ensure the entire drill is visible
      distance *= 1.5;
      
      // Always use 3D view mode
      const direction = cameraRef.current.position.clone().sub(controlsRef.current.target).normalize();
      cameraRef.current.position.copy(center.clone().add(direction.multiplyScalar(distance)));
      
      controlsRef.current.update();
      
      // Force a render
      if (rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    } catch (error) {
      console.error('Error in zoomToFit:', error);
      setRenderError('Failed to zoom to fit. Please refresh the page.');
    }
  };

  useEffect(() => {
    if (!containerRef.current) {
      console.error('Container ref is not available');
      return;
    }

    console.log('Container dimensions:', {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      offsetWidth: containerRef.current.offsetWidth,
      offsetHeight: containerRef.current.offsetHeight
    });

    if (!initializedRef.current) {
      console.log('Initializing Three.js scene');
      initializedRef.current = true;

      // Check WebGL support before doing anything
      if (!isWebGLAvailable()) {
        console.error("WebGL is not available!");
        setRenderError('WebGL is not supported in your browser');
        return;
      }

      try {
        // Setup scene with a clear background color
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0); 
        sceneRef.current = scene;

        // Setup camera with proper aspect ratio
        const camera = new THREE.PerspectiveCamera(
          75,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.1,
          1000
        );
        
        camera.position.set(30, 20, 30);
        cameraRef.current = camera;
        defaultCameraPositionRef.current = camera.position.clone();

        // Setup renderer with better performance settings
        const renderer = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
          stencil: false,
          depth: true
        });
        
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        console.log('Renderer created:', {
          width: renderer.domElement.width,
          height: renderer.domElement.height,
          pixelRatio: renderer.getPixelRatio(),
          capabilities: renderer.capabilities
        });
        
        // Add renderer to DOM
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Setup lights for better visualization
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 10, 15);
        directionalLight.castShadow = true;
        scene.add(directionalLight);
        
        const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
        backLight.position.set(-5, 5, -10);
        scene.add(backLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
        rimLight.position.set(10, 0, -10);
        scene.add(rimLight);

        const bottomLight = new THREE.DirectionalLight(0xffffff, 0.3);
        bottomLight.position.set(0, -10, 5);
        scene.add(bottomLight);

        // Setup grid
        const gridHelper = new THREE.GridHelper(60, 60, 0x666666, 0x999999);
        gridHelper.position.y = -parameters.length / 2 - 5;
        scene.add(gridHelper);

        // Setup dimensions
        const dimensionsGroup = new THREE.Group();
        scene.add(dimensionsGroup);
        dimensionsGroupRef.current = dimensionsGroup;

        // Setup orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 1;
        controls.maxDistance = 1000;
        controls.enablePan = true;
        controls.panSpeed = 0.8;
        controls.rotateSpeed = 0.8;
        controls.zoomSpeed = 1.2;
        controls.enableZoom = true;
        controls.maxPolarAngle = Math.PI;
        controls.minPolarAngle = 0;
        controlsRef.current = controls;

        // Create wheel listener
        wheelListenerRef.current = (event: WheelEvent) => {
          event.preventDefault();
          if (controlsRef.current && cameraRef.current) {
            const zoomFactor = 1.1;
            if (event.deltaY < 0) {
              cameraRef.current.position.lerp(controlsRef.current.target, 1 - 1/zoomFactor);
            } else {
              cameraRef.current.position.lerp(controlsRef.current.target, 1 - zoomFactor);
            }
            controlsRef.current.update();
          }
        };

        // Add wheel listener
        containerRef.current.addEventListener('wheel', wheelListenerRef.current, { passive: false });

        // Force immediate render
        renderer.render(scene, camera);
        console.log('Initial render completed');

        // Create animation loop
        const animate = () => {
          if (renderError) return;
          
          requestAnimationFrame(animate);
          
          if (controlsRef.current) {
            controlsRef.current.update();
          }
          
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
          
          // Notify parent component of camera updates
          if (onCameraUpdate && cameraRef.current) {
            onCameraUpdate(cameraRef.current);
          }
        };
        
        animate();
        console.log('Animation loop started');

      } catch (error) {
        console.error('Error initializing Three.js scene:', error);
        setRenderError(`Failed to initialize 3D viewer: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIsLoading(false);
      }
    }
  }, [onCameraUpdate]);

  const createDimensionLines = () => {
    if (!dimensionsGroupRef.current) return;

    while (dimensionsGroupRef.current.children.length > 0) {
      const child = dimensionsGroupRef.current.children[0];
      dimensionsGroupRef.current.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    const spacingFactor = Math.max(parameters.diameter, 5) * 0.8;
    
    createDimensionLine(
      new THREE.Vector3(-spacingFactor * 2.5, -parameters.length/2, 0),
      new THREE.Vector3(-spacingFactor * 2.5, parameters.length/2, 0),
      spacingFactor * 0.5,
      `${parameters.length} mm`,
      0x0066ff,
      false,
      "Length"
    );
    
    createDimensionLine(
      new THREE.Vector3(spacingFactor * 2, -parameters.length/2, 0),
      new THREE.Vector3(spacingFactor * 2, -parameters.length/2 + parameters.shankLength, 0),
      spacingFactor * 0.5,
      `${parameters.shankLength} mm`,
      0xaa00aa,
      false,
      "Shank"
    );
    
    createDimensionLine(
      new THREE.Vector3(spacingFactor * 2, -parameters.length/2 + parameters.shankLength, 0),
      new THREE.Vector3(spacingFactor * 2, -parameters.length/2 + parameters.shankLength + parameters.fluteLength, 0),
      spacingFactor * 0.5,
      `${parameters.fluteLength} mm`,
      0x00aa00,
      false,
      "Flute"
    );
    
    createDimensionLine(
      new THREE.Vector3(-parameters.diameter/2, -parameters.length/2 + parameters.shankLength + parameters.fluteLength/2, 0),
      new THREE.Vector3(parameters.diameter/2, -parameters.length/2 + parameters.shankLength + parameters.fluteLength/2, 0),
      spacingFactor * 0.8,
      `Ø${parameters.diameter} mm ${parameters.tolerance}`,
      0xff6600,
      true,
      "Dia"
    );
    
    createDimensionLine(
      new THREE.Vector3(-parameters.shankDiameter/2, -parameters.length/2 + parameters.shankLength/2, 0),
      new THREE.Vector3(parameters.shankDiameter/2, -parameters.length/2 + parameters.shankLength/2, 0),
      spacingFactor * 0.8,
      `Ø${parameters.shankDiameter} mm`,
      0x3366ff,
      true,
      "Shank Dia"
    );
    
    addTextLabel(
      new THREE.Vector3(0, -parameters.length/2 - spacingFactor, 0),
      `Tolerance: ${parameters.tolerance} (${formatTolerance(parameters.tolerance)})`,
      0x333333
    );
    
    addTextLabel(
      new THREE.Vector3(0, parameters.length/2 + spacingFactor * 0.8, 0),
      `Material: ${parameters.material.toUpperCase()}`,
      0x333333
    );
    
    addTextLabel(
      new THREE.Vector3(-spacingFactor * 3, 0, 0),
      `Flutes: ${parameters.fluteCount}`,
      0x333333
    );
    
    addTextLabel(
      new THREE.Vector3(-spacingFactor * 3, -spacingFactor, 0),
      `Helix: ${parameters.helixAngle}°`,
      0x333333
    );
    
    addTextLabel(
      new THREE.Vector3(-spacingFactor * 3, -spacingFactor * 2, 0),
      `Tip: ${parameters.tipAngle}°`,
      0x333333
    );
    
    addGDTSymbol(
      new THREE.Vector3(-spacingFactor * 3, -spacingFactor * 3, 0),
      "⌭ 0.01 mm",
      0xdd0000
    );
    
    addGDTSymbol(
      new THREE.Vector3(-spacingFactor * 3, -spacingFactor * 4, 0),
      "⌭ 0.02 mm TIR",
      0xdd0000
    );
  };

  const createDimensionLine = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    offsetDistance: number,
    labelText: string,
    color: number = 0x000000,
    horizontal: boolean = false,
    dimType: string = ""
  ) => {
    if (!dimensionsGroupRef.current) return;

    const dimensionGroup = new THREE.Group();
    dimensionsGroupRef.current.add(dimensionGroup);

    const lineMaterial = new THREE.LineBasicMaterial({ color, linewidth: 2 });

    let direction, perpendicular;
    if (horizontal) {
      direction = new THREE.Vector3(1, 0, 0);
      perpendicular = new THREE.Vector3(0, 1, 0);
    } else {
      direction = new THREE.Vector3().subVectors(end, start).normalize();
      perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
    }
    
    const offsetStart = new THREE.Vector3().addVectors(
      start, 
      perpendicular.clone().multiplyScalar(offsetDistance)
    );
    const offsetEnd = new THREE.Vector3().addVectors(
      end, 
      perpendicular.clone().multiplyScalar(offsetDistance)
    );

    const dimensionGeometry = new THREE.BufferGeometry().setFromPoints([offsetStart, offsetEnd]);
    const dimensionLine = new THREE.Line(dimensionGeometry, lineMaterial);
    dimensionGroup.add(dimensionLine);

    const extension1Geometry = new THREE.BufferGeometry().setFromPoints([start, offsetStart]);
    const extension2Geometry = new THREE.BufferGeometry().setFromPoints([end, offsetEnd]);
    dimensionGroup.add(new THREE.Line(extension1Geometry, lineMaterial));
    dimensionGroup.add(new THREE.Line(extension2Geometry, lineMaterial));

    const arrowSize = offsetDistance * 0.15;
    const arrowAngle = Math.PI / 6;

    if (horizontal) {
      const arrowLeft1 = offsetStart.clone().add(new THREE.Vector3(arrowSize * Math.cos(arrowAngle), arrowSize * Math.sin(arrowAngle), 0));
      const arrowLeft2 = offsetStart.clone().add(new THREE.Vector3(arrowSize * Math.cos(arrowAngle), -arrowSize * Math.sin(arrowAngle), 0));
      const arrowRight1 = offsetEnd.clone().add(new THREE.Vector3(-arrowSize * Math.cos(arrowAngle), arrowSize * Math.sin(arrowAngle), 0));
      const arrowRight2 = offsetEnd.clone().add(new THREE.Vector3(-arrowSize * Math.cos(arrowAngle), -arrowSize * Math.sin(arrowAngle), 0));

      dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowLeft1, offsetStart, arrowLeft2]), lineMaterial));
      dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowRight1, offsetEnd, arrowRight2]), lineMaterial));
    } else {
      const arrowStart1 = offsetStart.clone().add(direction.clone().multiplyScalar(arrowSize).applyAxisAngle(new THREE.Vector3(0, 0, 1), arrowAngle));
      const arrowStart2 = offsetStart.clone().add(direction.clone().multiplyScalar(arrowSize).applyAxisAngle(new THREE.Vector3(0, 0, 1), -arrowAngle));
      const arrowEnd1 = offsetEnd.clone().add(direction.clone().multiplyScalar(-arrowSize).applyAxisAngle(new THREE.Vector3(0, 0, 1), arrowAngle));
      const arrowEnd2 = offsetEnd.clone().add(direction.clone().multiplyScalar(-arrowSize).applyAxisAngle(new THREE.Vector3(0, 0, 1), -arrowAngle));

      dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowStart1, offsetStart, arrowStart2]), lineMaterial));
      dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([arrowEnd1, offsetEnd, arrowEnd2]), lineMaterial));
    }
    
    const textPosition = new THREE.Vector3().addVectors(offsetStart, offsetEnd).multiplyScalar(0.5);
    addTextLabel(textPosition, labelText, color);
    
    if (dimType) {
      const typePos = textPosition.clone();
      if (horizontal) {
        typePos.y += 1.5;
      } else {
        typePos.x -= 2;
      }
      addDimensionTypeLabel(typePos, dimType, color);
    }
  };

  const addDimensionTypeLabel = (position: THREE.Vector3, text: string, color: number) => {
    if (!dimensionsGroupRef.current) return;
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    
    canvas.width = 128;
    canvas.height = 32;
    
    context.font = 'bold 20px Arial';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(2.5, 0.6, 1);
    
    dimensionsGroupRef.current.add(sprite);
  };

  const addTextLabel = (position: THREE.Vector3, text: string, color: number) => {
    if (!dimensionsGroupRef.current) return;
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    
    canvas.width = 512;
    canvas.height = 64;
    
    context.font = 'bold 24px Arial';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(6, 0.8, 1);
    
    dimensionsGroupRef.current.add(sprite);
  };

  const addGDTSymbol = (position: THREE.Vector3, text: string, color: number) => {
    if (!dimensionsGroupRef.current) return;
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    
    canvas.width = 256;
    canvas.height = 64;
    
    context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.lineWidth = 2;
    context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    
    context.font = 'bold 24px Arial';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(5, 1.25, 1);
    
    dimensionsGroupRef.current.add(sprite);
  };

  const formatTolerance = (tol: string): string => {
    switch (tol) {
      case 'h6': return '0 to -0.016 mm';
      case 'h7': return '0 to -0.025 mm';
      case 'h8': return '0 to -0.039 mm';
      case 'h9': return '0 to -0.062 mm';
      case 'h10': return '0 to -0.100 mm';
      case 'H6': return '+0.016 to 0 mm';
      case 'H7': return '+0.025 to 0 mm';
      case 'H8': return '+0.039 to 0 mm';
      default: return tol;
    }
  };

  useEffect(() => {
    if (!sceneRef.current) return;
    
    setIsLoading(true);
    console.log('Updating drill model with parameters:', parameters);
    
    try {
      if (cameraRef.current && controlsRef.current && drillMeshRef.current) {
        defaultCameraPositionRef.current = cameraRef.current.position.clone();
      }
      
      // Clean up old drill model
      if (drillMeshRef.current && sceneRef.current) {
        sceneRef.current.remove(drillMeshRef.current);
        drillMeshRef.current.geometry.dispose();
        if (drillMeshRef.current.material instanceof THREE.Material) {
          drillMeshRef.current.material.dispose();
        } else if (Array.isArray(drillMeshRef.current.material)) {
          drillMeshRef.current.material.forEach(m => m.dispose());
        }
      }
      
      // Generate new drill geometry
      const drillGeometry = generateDrillGeometry(parameters);
      
      // Create material based on parameters with better visibility
      let material: THREE.Material;
      
      // Default shiny gray material
      material = new THREE.MeshPhongMaterial({
        color: '#808080',  // Medium gray
        shininess: 100,   // High shininess for metallic look
        specular: 0x666666,  // Gray specular highlights
        emissive: 0x000000,
        flatShading: false,
        wireframe: wireframe
      });
      
      // Apply surface finish effects with better visibility
      if (parameters.surfaceFinish === 'black-oxide') {
        material = new THREE.MeshPhongMaterial({
          color: 0x1e293b,
          shininess: 40,
          specular: 0x333333,
          emissive: 0x000000,
          flatShading: false,
          wireframe: wireframe
        });
      } else if (parameters.surfaceFinish === 'tin') {
        material = new THREE.MeshPhongMaterial({
          color: 0xfcd34d,
          shininess: 90,
          specular: 0x777777,
          emissive: 0x000000,
          flatShading: false,
          wireframe: wireframe
        });
      } else if (parameters.surfaceFinish === 'aln') {
        material = new THREE.MeshPhongMaterial({
          color: 0xd1d5db,
          shininess: 85,
          specular: 0x666666,
          emissive: 0x000000,
          flatShading: false,
          wireframe: wireframe
        });
      }
      
      // Create mesh and add to scene
      const drillMesh = new THREE.Mesh(drillGeometry, material);
      drillMesh.castShadow = true;
      drillMesh.receiveShadow = true;
      
      sceneRef.current.add(drillMesh);
      drillMeshRef.current = drillMesh;
      
      // No longer create dimension lines in 2D mode
      
      // Automatically fit the view to the drill
      setTimeout(() => {
        // Always use 3D view mode
        const maxDimension = Math.max(
          parameters.length,
          parameters.diameter * 2,
          parameters.shankDiameter * 2
        );
        
        const cameraDistance = maxDimension * 2;
        if (cameraRef.current && controlsRef.current) {
          cameraRef.current.position.set(
            cameraDistance * 0.7,
            cameraDistance * 0.5,
            cameraDistance * 0.7
          );
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }
        
        // Force an immediate render
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
        
        setIsLoading(false);
      }, 100);
      
    } catch (error) {
      console.error('Error updating drill model:', error);
      setRenderError(`Failed to update drill model: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  }, [parameters, viewMode, wireframe]);

  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current || !sceneRef.current || !dimensionsGroupRef.current) return;
    
    try {
      defaultCameraPositionRef.current = cameraRef.current.position.clone();
      
      // Always hide dimensions group (2D view elements)
      dimensionsGroupRef.current.visible = false;
      
      // Always use 3D view mode
      cameraRef.current.position.copy(defaultCameraPositionRef.current);
      controlsRef.current.enableRotate = true;
      controlsRef.current.update();
      
      resetView();
    } catch (error) {
      console.error('Error switching view mode:', error);
      setRenderError(`Failed to switch view mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
  }, [viewMode, isHandMode]);

  const toggleHandMode = () => {
    if (!controlsRef.current) return;
    
    setIsHandMode(!isHandMode);
    
    if (controlsRef.current) {
      controlsRef.current.enableRotate = !isHandMode;
      controlsRef.current.enablePan = isHandMode;
    }
  };

  useEffect(() => {
    setTimeout(() => {
      resetView();
      setIsLoading(false);
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (containerRef.current && wheelListenerRef.current) {
        containerRef.current.removeEventListener('wheel', wheelListenerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      
      // Get the actual container dimensions
      const rect = containerRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      // Update renderer size
      rendererRef.current.setSize(width, height);
      
      // Update camera aspect ratio
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      
      // Always use 3D view mode
      
      // Force a render
      if (sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    // Add resize observer for more reliable size detection
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Also handle window resize
    window.addEventListener('resize', handleResize);
    
    // Initial resize
    handleResize();

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [parameters, viewMode]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full relative min-h-[70vh]"
      style={{ backgroundColor: '#f8fafc' }}
    >
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={toggleHandMode}
          className={`bg-white/80 hover:bg-white ${isHandMode ? 'ring-2 ring-primary' : ''}`}
          title={isHandMode ? "Disable hand mode" : "Enable hand mode (drag model)"}
        >
          <Hand size={18} />
        </Button>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={resetView}
          className="bg-white/80 hover:bg-white"
          title="Reset view"
        >
          <RotateCcw size={18} />
        </Button>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={zoomToFit}
          className="bg-white/80 hover:bg-white"
          title="Zoom to fit"
        >
          <Maximize size={18} />
        </Button>
      </div>
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
      
      {renderError && (
        <div className="absolute inset-0 flex items-center justify-center text-red-500">
          {renderError}
        </div>
      )}
      
      {viewMode === '2d' && (
        <div className="absolute left-4 top-4 bg-white/90 dark:bg-black/50 p-3 rounded shadow text-xs">
          <h3 className="font-medium text-sm mb-2">Drill Dimensions</h3>
          <ul className="space-y-1.5">
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-blue-500 rounded-full"></span>
              <span>Total Length: {parameters.length}mm</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-red-500 rounded-full"></span>
              <span>Non-cutting Length: {parameters.nonCuttingLength.toFixed(2)}mm</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-green-600 rounded-full"></span>
              <span>Flute Length: {parameters.fluteLength}mm</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-purple-500 rounded-full"></span>
              <span>Shank Length: {parameters.shankLength}mm</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-orange-500 rounded-full"></span>
              <span>Diameter: {parameters.diameter}mm {parameters.tolerance}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="w-3 h-3 inline-block bg-blue-400 rounded-full"></span>
              <span>Shank Diameter: {parameters.shankDiameter}mm</span>
            </li>
          </ul>
        </div>
      )}
      
      {/* Debug info */}
      <div className="absolute bottom-4 left-4 bg-white/90 dark:bg-black/50 p-2 rounded shadow text-xs">
        <div>WebGL: {isWebGLAvailable() ? 'Available' : 'Not Available'}</div>
        <div>View Mode: {viewMode}</div>
        <div>Loading: {isLoading ? 'Yes' : 'No'}</div>
        {renderError && <div className="text-red-500">Error: {renderError}</div>}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to prevent unnecessary re-renders
  return (
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.wireframe === nextProps.wireframe &&
    JSON.stringify(prevProps.parameters) === JSON.stringify(nextProps.parameters)
  );
});

export { DrillViewer };
