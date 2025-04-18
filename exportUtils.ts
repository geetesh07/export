import * as THREE from 'three';
import Drawing from 'dxf-writer';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { generateDrillGeometry } from './drillGenerator';
import { DrillParameters } from '@/types/drill';
import { toast } from 'react-hot-toast';

export const enhancedThreeJsToDXF = (
  threeJsModel: THREE.Object3D,
  filename: string,
  options = { includeTopView: true, includeFrontView: true, includeSideView: true }
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      console.log('Creating DXF drawing...');
      const drawing = new Drawing();
      
      // Add layers for different parts of the drawing
      drawing.addLayer('Outline', 7, 'CONTINUOUS');  // White
      drawing.addLayer('Centerlines', 1, 'CENTER');  // Red
      drawing.addLayer('Text', 4, 'CONTINUOUS');     // Cyan
      
      // Get bounding box
      const bbox = new THREE.Box3().setFromObject(threeJsModel);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      
      const margin = Math.max(size.x, size.y, size.z) * 0.5;
      const offsetY = size.y + margin * 2;
      
      // Add title and date
      drawing.addLayer('Text', 4, 'CONTINUOUS');
      drawing.drawText(10, 10, 5, 0, `${filename} - Technical Drawing`);
      drawing.drawText(10, 20, 3, 0, `Date: ${new Date().toLocaleDateString()}`);
      
      // Create orthographic camera for projections
      const orthoCamera = new THREE.OrthographicCamera(
        -size.x/2, size.x/2, 
        size.y/2, -size.y/2, 
        0.1, 1000
      );
      
      // Simple projection functions
      const projectToTop = (point: THREE.Vector3) => ({
        x: point.x,
        y: point.z
      });
      
      const projectToFront = (point: THREE.Vector3) => ({
        x: point.x,
        y: point.y
      });
      
      const projectToSide = (point: THREE.Vector3) => ({
        x: point.z,
        y: point.y
      });
      
      // Extract and draw contours
      const extractAndDrawContours = (object: THREE.Object3D, projectFn: (point: THREE.Vector3) => { x: number, y: number }, offset: { x: number, y: number }, scale: number) => {
        const edgeMap = new Map<string, number>();
        const contours: { start: THREE.Vector3, end: THREE.Vector3 }[] = [];
        
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const geometry = child.geometry;
            const positionAttribute = geometry.getAttribute('position');
            const positions = new Float32Array(positionAttribute.array);
            
            // First pass: count edge occurrences
            for (let i = 0; i < positions.length; i += 9) {
              const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
              const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
              const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);
              
              const edges = [
                [v1, v2],
                [v2, v3],
                [v3, v1]
              ];
              
              for (const [start, end] of edges) {
                const key = `${Math.min(start.x, end.x).toFixed(2)},${Math.min(start.y, end.y).toFixed(2)},${Math.min(start.z, end.z).toFixed(2)}-${Math.max(start.x, end.x).toFixed(2)},${Math.max(start.y, end.y).toFixed(2)},${Math.max(start.z, end.z).toFixed(2)}`;
                edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
              }
            }
            
            // Second pass: collect contour edges (edges that appear only once)
            for (let i = 0; i < positions.length; i += 9) {
              const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
              const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
              const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);
              
              const edges = [
                [v1, v2],
                [v2, v3],
                [v3, v1]
              ];
              
              for (const [start, end] of edges) {
                const key = `${Math.min(start.x, end.x).toFixed(2)},${Math.min(start.y, end.y).toFixed(2)},${Math.min(start.z, end.z).toFixed(2)}-${Math.max(start.x, end.x).toFixed(2)},${Math.max(start.y, end.y).toFixed(2)},${Math.max(start.z, end.z).toFixed(2)}`;
                if (edgeMap.get(key) === 1) {
                  contours.push({ start, end });
                }
              }
            }
          }
        });
        
        // Draw the contours
        for (const { start, end } of contours) {
          const p1 = projectFn(start);
          const p2 = projectFn(end);
          
          drawing.drawLine(
            offset.x + p1.x * scale,
            offset.y + p1.y * scale,
            offset.x + p2.x * scale,
            offset.y + p2.y * scale
          );
        }
      };
      
      if (options.includeTopView) {
        console.log('Adding top view...');
        drawing.addLayer('Outline', 7, 'CONTINUOUS');
        extractAndDrawContours(threeJsModel, projectToTop, { x: margin, y: offsetY * 2 }, 1.0);
        
        drawing.addLayer('Centerlines', 1, 'CENTER');
        drawing.drawLine(margin - size.x/2, offsetY * 2, margin + size.x/2, offsetY * 2);
        drawing.drawLine(margin, offsetY * 2 - size.z/2, margin, offsetY * 2 + size.z/2);
        
        drawing.addLayer('Text', 4, 'CONTINUOUS');
        drawing.drawText(margin, offsetY * 2 - size.z/2 - 10, 3.5, 0, 'TOP VIEW');
      }
      
      if (options.includeFrontView) {
        console.log('Adding front view...');
        drawing.addLayer('Outline', 7, 'CONTINUOUS');
        extractAndDrawContours(threeJsModel, projectToFront, { x: margin, y: offsetY }, 1.0);
        
        drawing.addLayer('Centerlines', 1, 'CENTER');
        drawing.drawLine(margin, offsetY - size.y/2, margin, offsetY + size.y/2);
        
        drawing.addLayer('Text', 4, 'CONTINUOUS');
        drawing.drawText(margin, offsetY - size.y/2 - 10, 3.5, 0, 'FRONT VIEW');
      }
      
      if (options.includeSideView) {
        console.log('Adding side view...');
        drawing.addLayer('Outline', 7, 'CONTINUOUS');
        extractAndDrawContours(threeJsModel, projectToSide, { x: margin + size.x + margin, y: offsetY }, 1.0);
        
        drawing.addLayer('Centerlines', 1, 'CENTER');
        drawing.drawLine(margin + size.x + margin, offsetY - size.y/2, margin + size.x + margin, offsetY + size.y/2);
        
        drawing.addLayer('Text', 4, 'CONTINUOUS');
        drawing.drawText(margin + size.x + margin, offsetY - size.y/2 - 10, 3.5, 0, 'SIDE VIEW');
      }
      
      console.log('Generating DXF content...');
      const dxfString = drawing.toDxfString();
      
      console.log('Creating download...');
      const blob = new Blob([dxfString], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.dxf`;
      document.body.appendChild(link);
      
      setTimeout(() => {
        console.log('Triggering download...');
        link.click();
        
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('Successfully exported enhanced DXF file');
          resolve();
        }, 100);
      }, 100);
      
    } catch (error) {
      console.error('Export error:', error);
      reject(new Error(`DXF export failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
};

function addTopView(drawing: any, object: THREE.Object3D, camera: THREE.OrthographicCamera, { x, y, scale }: { x: number, y: number, scale: number }) {
  drawing.setActiveLayer('Outline');
  
  // Create a new scene for this view
  const scene = new THREE.Scene();
  const clone = object.clone();
  scene.add(clone);
  
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 1, 0);
  
  // Extract key edges for top view
  const edges = extractKeyEdges(clone, 'top');
  
  for (const edge of edges) {
    const start = edge.start;
    const end = edge.end;
    
    const startProjected = projectPointToPlane(start, camera);
    const endProjected = projectPointToPlane(end, camera);
    
    drawing.drawLine(
      x + startProjected.x * scale,
      y + startProjected.y * scale,
      x + endProjected.x * scale, 
      y + endProjected.y * scale
    );
  }
  
  // Add centerlines
  drawing.setActiveLayer('Centerlines');
  const radius = Math.max(...edges.map(e => Math.max(
    Math.abs(e.start.x), Math.abs(e.start.y),
    Math.abs(e.end.x), Math.abs(e.end.y)
  )));
  
  drawing.drawLine(x - radius * scale, y, x + radius * scale, y);
  drawing.drawLine(x, y - radius * scale, x, y + radius * scale);
  
  drawing.setActiveLayer('Text');
  drawing.drawText(x, y - radius * scale - 10, 3.5, 0, 'TOP VIEW');
}

function addFrontView(drawing: any, object: THREE.Object3D, camera: THREE.OrthographicCamera, { x, y, scale }: { x: number, y: number, scale: number }) {
  drawing.setActiveLayer('Outline');
  
  // Create a new scene for this view
  const scene = new THREE.Scene();
  const clone = object.clone();
  scene.add(clone);
  
  camera.position.set(0, 1000, 0);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 0, 1);
  
  const edges = extractKeyEdges(clone, 'front');
  
  for (const edge of edges) {
    const start = edge.start;
    const end = edge.end;
    
    const startProjected = projectPointToPlane(start, camera);
    const endProjected = projectPointToPlane(end, camera);
    
    drawing.drawLine(
      x + startProjected.x * scale,
      y + startProjected.y * scale,
      x + endProjected.x * scale, 
      y + endProjected.y * scale
    );
  }
  
  // Add centerline
  drawing.setActiveLayer('Centerlines');
  const height = Math.max(...edges.map(e => Math.max(
    Math.abs(e.start.y), Math.abs(e.end.y)
  )));
  
  drawing.drawLine(x, y - height * scale, x, y + height * scale);
  
  drawing.setActiveLayer('Text');
  drawing.drawText(x, y - height * scale - 10, 3.5, 0, 'FRONT VIEW');
}

function addSideView(drawing: any, object: THREE.Object3D, camera: THREE.OrthographicCamera, { x, y, scale }: { x: number, y: number, scale: number }) {
  drawing.setActiveLayer('Outline');
  
  // Create a new scene for this view
  const scene = new THREE.Scene();
  const clone = object.clone();
  scene.add(clone);
  
  camera.position.set(1000, 0, 0);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 1, 0);
  
  const edges = extractKeyEdges(clone, 'side');
  
  for (const edge of edges) {
    const start = edge.start;
    const end = edge.end;
    
    const startProjected = projectPointToPlane(start, camera);
    const endProjected = projectPointToPlane(end, camera);
    
      drawing.drawLine(
      x + startProjected.x * scale,
      y + startProjected.y * scale,
      x + endProjected.x * scale, 
      y + endProjected.y * scale
    );
  }
  
  // Add centerline
  drawing.setActiveLayer('Centerlines');
  const height = Math.max(...edges.map(e => Math.max(
    Math.abs(e.start.y), Math.abs(e.end.y)
  )));
  
  drawing.drawLine(x, y - height * scale, x, y + height * scale);
  
  drawing.setActiveLayer('Text');
  drawing.drawText(x, y - height * scale - 10, 3.5, 0, 'SIDE VIEW');
}

function extractKeyEdges(object: THREE.Object3D, view: 'top' | 'front' | 'side'): { start: THREE.Vector3, end: THREE.Vector3 }[] {
  const edges: { start: THREE.Vector3, end: THREE.Vector3 }[] = [];
  const processedEdges = new Set<string>();
  
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry;
      
      // Get position attribute
      const positionAttribute = geometry.getAttribute('position');
      const positions = new Float32Array(positionAttribute.array);
      
      // Get index attribute if it exists
      const indexAttribute = geometry.index;
      const indices = indexAttribute ? new Uint32Array(indexAttribute.array) : null;
      
      if (indices) {
        // For indexed geometry
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i];
          const b = indices[i + 1];
          const c = indices[i + 2];
          
          const v1 = new THREE.Vector3(
            positions[a * 3],
            positions[a * 3 + 1],
            positions[a * 3 + 2]
          ).applyMatrix4(child.matrixWorld);
          
          const v2 = new THREE.Vector3(
            positions[b * 3],
            positions[b * 3 + 1],
            positions[b * 3 + 2]
          ).applyMatrix4(child.matrixWorld);
          
          const v3 = new THREE.Vector3(
            positions[c * 3],
            positions[c * 3 + 1],
            positions[c * 3 + 2]
          ).applyMatrix4(child.matrixWorld);
          
          // Only add edges that are visible in the current view
          if (isEdgeVisible(v1, v2, v3, view)) {
            // Create unique keys for each edge to avoid duplicates
            const edge1Key = `${v1.x.toFixed(2)},${v1.y.toFixed(2)},${v1.z.toFixed(2)}-${v2.x.toFixed(2)},${v2.y.toFixed(2)},${v2.z.toFixed(2)}`;
            const edge2Key = `${v2.x.toFixed(2)},${v2.y.toFixed(2)},${v2.z.toFixed(2)}-${v3.x.toFixed(2)},${v3.y.toFixed(2)},${v3.z.toFixed(2)}`;
            const edge3Key = `${v3.x.toFixed(2)},${v3.y.toFixed(2)},${v3.z.toFixed(2)}-${v1.x.toFixed(2)},${v1.y.toFixed(2)},${v1.z.toFixed(2)}`;
            
            if (!processedEdges.has(edge1Key)) {
              edges.push({ start: v1, end: v2 });
              processedEdges.add(edge1Key);
            }
            
            if (!processedEdges.has(edge2Key)) {
              edges.push({ start: v2, end: v3 });
              processedEdges.add(edge2Key);
            }
            
            if (!processedEdges.has(edge3Key)) {
              edges.push({ start: v3, end: v1 });
              processedEdges.add(edge3Key);
            }
          }
        }
      } else {
        // For non-indexed geometry
        for (let i = 0; i < positions.length; i += 9) {
          const v1 = new THREE.Vector3(
            positions[i],
            positions[i + 1],
            positions[i + 2]
          ).applyMatrix4(child.matrixWorld);
          
          const v2 = new THREE.Vector3(
            positions[i + 3],
            positions[i + 4],
            positions[i + 5]
          ).applyMatrix4(child.matrixWorld);
          
          const v3 = new THREE.Vector3(
            positions[i + 6],
            positions[i + 7],
            positions[i + 8]
          ).applyMatrix4(child.matrixWorld);
          
          if (isEdgeVisible(v1, v2, v3, view)) {
            // Create unique keys for each edge to avoid duplicates
            const edge1Key = `${v1.x.toFixed(2)},${v1.y.toFixed(2)},${v1.z.toFixed(2)}-${v2.x.toFixed(2)},${v2.y.toFixed(2)},${v2.z.toFixed(2)}`;
            const edge2Key = `${v2.x.toFixed(2)},${v2.y.toFixed(2)},${v2.z.toFixed(2)}-${v3.x.toFixed(2)},${v3.y.toFixed(2)},${v3.z.toFixed(2)}`;
            const edge3Key = `${v3.x.toFixed(2)},${v3.y.toFixed(2)},${v3.z.toFixed(2)}-${v1.x.toFixed(2)},${v1.y.toFixed(2)},${v1.z.toFixed(2)}`;
            
            if (!processedEdges.has(edge1Key)) {
              edges.push({ start: v1, end: v2 });
              processedEdges.add(edge1Key);
            }
            
            if (!processedEdges.has(edge2Key)) {
              edges.push({ start: v2, end: v3 });
              processedEdges.add(edge2Key);
            }
            
            if (!processedEdges.has(edge3Key)) {
              edges.push({ start: v3, end: v1 });
              processedEdges.add(edge3Key);
            }
          }
        }
      }
    }
  });
  
  return edges;
}

function isEdgeVisible(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3, view: 'top' | 'front' | 'side'): boolean {
  // Calculate face normal
  const normal = new THREE.Vector3()
    .crossVectors(
      new THREE.Vector3().subVectors(v2, v1),
      new THREE.Vector3().subVectors(v3, v1)
    )
    .normalize();
  
  // Check visibility based on view
  switch (view) {
    case 'top':
      return Math.abs(normal.z) > 0.5;
    case 'front':
      return Math.abs(normal.y) > 0.5;
    case 'side':
      return Math.abs(normal.x) > 0.5;
    default:
      return false;
  }
}

function projectPointToPlane(point: THREE.Vector3, camera: THREE.Camera): { x: number, y: number } {
  const vector = point.clone();
  vector.project(camera);
  return {
    x: vector.x,
    y: vector.y
  };
}

function drawDimensions(drawing: any, size: THREE.Vector3, margin: number, offsetY: number) {
  drawing.setActiveLayer('Dimensions');
  
  const topX = margin;
  const topY = offsetY * 2;
  
  const dimOffset = 20;
  drawing.drawLine(topX, topY + dimOffset, topX + size.x, topY + dimOffset);
  drawing.drawLine(topX, topY + dimOffset - 5, topX, topY + dimOffset + 5);
  drawing.drawLine(topX + size.x, topY + dimOffset - 5, topX + size.x, topY + dimOffset + 5);
  drawing.drawText(topX + size.x/2, topY + dimOffset + 10, 3, 0, `${size.x.toFixed(2)}`);
  
  drawing.drawLine(topX + size.x + dimOffset, topY, topX + size.x + dimOffset, topY + size.y);
  drawing.drawLine(topX + size.x + dimOffset - 5, topY, topX + size.x + dimOffset + 5, topY);
  drawing.drawLine(topX + size.x + dimOffset - 5, topY + size.y, topX + size.x + dimOffset + 5, topY + size.y);
  drawing.drawText(topX + size.x + dimOffset + 10, topY + size.y/2, 3, 90, `${size.y.toFixed(2)}`);
  
  const frontX = margin;
  const frontY = offsetY;
  
  drawing.drawLine(frontX, frontY + dimOffset, frontX + size.x, frontY + dimOffset);
  drawing.drawLine(frontX, frontY + dimOffset - 5, frontX, frontY + dimOffset + 5);
  drawing.drawLine(frontX + size.x, frontY + dimOffset - 5, frontX + size.x, frontY + dimOffset + 5);
  drawing.drawText(frontX + size.x/2, frontY + dimOffset + 10, 3, 0, `${size.x.toFixed(2)}`);
  
  drawing.drawLine(frontX + size.x + dimOffset, frontY, frontX + size.x + dimOffset, frontY + size.z);
  drawing.drawLine(frontX + size.x + dimOffset - 5, frontY, frontX + size.x + dimOffset + 5, frontY);
  drawing.drawLine(frontX + size.x + dimOffset - 5, frontY + size.z, frontX + size.x + dimOffset + 5, frontY + size.z);
  drawing.drawText(frontX + size.x + dimOffset + 10, frontY + size.z/2, 3, 90, `${size.z.toFixed(2)}`);
}

export const exportDrillToDXF = async (
  parameters: DrillParameters,
  filename: string
): Promise<void> => {
  try {
    console.log('Starting DXF export process...');
    
    const drillGeometry = generateDrillGeometry(parameters);
    const mesh = new THREE.Mesh(drillGeometry);
    const group = new THREE.Group();
    group.add(mesh);
    
    if (parameters.fluteCount > 0) {
      console.log('Adding helix lines for flutes...');
      const { 
        diameter, 
        length, 
        shankLength,
        fluteCount,
        helixAngle,
        fluteLength
      } = parameters;
      
      const helixSegments = 32;
      const helixRadius = diameter / 2;
      const helixHeight = fluteLength;
      const helixAngleRad = (helixAngle * Math.PI) / 180;
      
      for (let i = 0; i < fluteCount; i++) {
        const startAngle = (i / fluteCount) * Math.PI * 2;
        const points = [];
        
        for (let j = 0; j <= helixSegments; j++) {
          const t = j / helixSegments;
          const angle = startAngle + t * Math.PI * 2 * helixAngle / 360;
          const y = -length / 2 + shankLength + t * helixHeight;
          const x = helixRadius * Math.cos(angle);
          const z = helixRadius * Math.sin(angle);
          points.push(new THREE.Vector3(x, y, z));
        }
        
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        group.add(line);
      }
    }
    
    console.log('Converting to DXF format...');
    await enhancedThreeJsToDXF(group, filename);
    
    console.log('DXF export completed successfully');
  } catch (error) {
    console.error('Failed to export DXF:', error);
    throw new Error(`DXF export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const exportDrillToSTL = async (
  parameters: DrillParameters,
  filename: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      const geometry = generateDrillGeometry(parameters);
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(geometry);
      scene.add(mesh);
      
      const exporter = new STLExporter();
      const stlContent = exporter.parse(scene, { binary: true });
      
      const blob = new Blob([stlContent], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.stl`;
      document.body.appendChild(link);
      
      setTimeout(() => {
        link.click();
        
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('Successfully exported STL file');
          resolve();
        }, 100);
      }, 100);
    } catch (error) {
      console.error('Error generating STL:', error);
      reject(error);
    }
  });
};

export const exportDrillToSTEP = async (
  parameters: DrillParameters,
  filename: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      console.log('Starting STEP export process...');
      
      const timestamp = new Date().toISOString();
      const stepHeader = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Drill bit model', 'Generated by Drill Designer Pro'), '2;1');
FILE_NAME(
  '${filename}.step',
  '${timestamp}',
  ('Drill Designer Pro'),
  ('CNC Drill Design Software'),
  'Drill Designer Pro v1.0',
  ('Drill Designer Pro STEP converter'),
  ''
);
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;

/* ================ Drill Parameters ================ */
/* Diameter: ${parameters.diameter} mm */
/* Length: ${parameters.length} mm */
/* Shank Diameter: ${parameters.shankDiameter} mm */
/* Shank Length: ${parameters.shankLength} mm */
/* Flute Count: ${parameters.fluteCount} */
/* Flute Length: ${parameters.fluteLength} mm */
/* Non-Cutting Length: ${parameters.nonCuttingLength} mm */
/* Tip Angle: ${parameters.tipAngle}° */
/* Helix Angle: ${parameters.helixAngle}° */
/* Material: ${parameters.material} */
/* Tolerance: ${parameters.tolerance} */
/* Surface Finish: ${parameters.surfaceFinish} */

/* ================ STEP 3D Model Data ================ */
/* This is a simplified representation of what would be generated by a real STEP exporter */
/* The actual STEP file would contain full 3D geometry data */

#1 = APPLICATION_CONTEXT('automotive design');
#2 = APPLICATION_PROTOCOL_DEFINITION('draft international standard','automotive_design',1998,#1);
#3 = MECHANICAL_CONTEXT('none',#1,'mechanical');
#4 = PRODUCT('${filename}','Drill bit','',(#3));
#5 = PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#4));
#6 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#4,.NOT_KNOWN.);
#7 = PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#8 = PRODUCT_DEFINITION('',' ',#6,#7);

/* Coordinate system */
#10 = CARTESIAN_POINT('',(0.,0.,0.));
#11 = DIRECTION('',(0.,0.,1.));
#12 = DIRECTION('',(1.,0.,0.));
#13 = AXIS2_PLACEMENT_3D('',#10,#11,#12);

/* Shank cylinder */
#20 = CYLINDRICAL_SURFACE('',#13,${parameters.shankDiameter/2});
#21 = ORIENTED_EDGE('',*,*,#22,.F.);
#22 = EDGE_CURVE('',#23,#24,#25,.T.);
#23 = VERTEX_POINT('',#24);
#24 = CARTESIAN_POINT('',(${parameters.shankDiameter/2},0.,0.));
#25 = CIRCLE('',#13,${parameters.shankDiameter/2});

/* Fluted cylinder */
#30 = CYLINDRICAL_SURFACE('',#13,${parameters.diameter/2});
#31 = ORIENTED_EDGE('',*,*,#32,.F.);
#32 = EDGE_CURVE('',#33,#34,#35,.T.);
#33 = VERTEX_POINT('',#34);
#34 = CARTESIAN_POINT('',(${parameters.diameter/2},0.,${-parameters.shankLength}));
#35 = CIRCLE('',#36,${parameters.diameter/2});
#36 = AXIS2_PLACEMENT_3D('',#37,#11,#12);
#37 = CARTESIAN_POINT('',(0.,0.,${-parameters.shankLength}));

/* Cone tip */
#40 = CONICAL_SURFACE('',#41,${parameters.diameter/2},${90 - parameters.tipAngle/2});
#41 = AXIS2_PLACEMENT_3D('',#42,#11,#12);
#42 = CARTESIAN_POINT('',(0.,0.,${-parameters.length + parameters.tipAngle/(2*Math.tan(parameters.tipAngle*Math.PI/360))}));

/* Helix curves for flutes */
${generateFlutesStepData(parameters)}

/* Assembly Information */
#100 = SHAPE_DEFINITION_REPRESENTATION(#101,#102);
#101 = PRODUCT_DEFINITION_SHAPE('','',#8);
#102 = ADVANCED_BREP_SHAPE_REPRESENTATION('',(#13,#20,#30,#40),#103);
#103 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) 
GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#104)) GLOBAL_UNIT_ASSIGNED_CONTEXT
((#105,#106,#107)) REPRESENTATION_CONTEXT('Context #1',
  '3D Context with UNIT and UNCERTAINTY') );
#104 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#105,
  'distance_accuracy_value','confusion accuracy');
#105 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#106 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#107 = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );

ENDSEC;
END-ISO-10303-21;`;
      
      const blob = new Blob([stepHeader], { type: 'application/step' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.step`;
      document.body.appendChild(link);
      
      setTimeout(() => {
        link.click();
        
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('Successfully exported STEP file');
          resolve();
        }, 100);
      }, 100);
    } catch (error) {
      console.error('Error generating STEP file:', error);
      reject(error);
    }
  });
};

function generateFlutesStepData(parameters: DrillParameters): string {
  let fluteData = '';
  
  if (parameters.fluteCount > 0) {
    const radius = parameters.diameter / 2;
    const helixPitch = Math.PI * parameters.diameter / Math.tan((parameters.helixAngle * Math.PI) / 180);
    
    for (let i = 0; i < parameters.fluteCount; i++) {
      const baseAngle = (2 * Math.PI * i) / parameters.fluteCount;
      const startIndex = 200 + i * 10;
      
      fluteData += `/* Flute ${i+1} */
#${startIndex} = HELIX('Flute ${i+1}',#${startIndex+1},${radius},${helixPitch},${baseAngle});
#${startIndex+1} = AXIS2_PLACEMENT_3D('',#${startIndex+2},#11,#12);
#${startIndex+2} = CARTESIAN_POINT('',(0.,0.,${-parameters.shankLength}));
`;
    }
  }
  
  return fluteData;
}

export const exportDrillModel = async (
  parameters: DrillParameters,
  format: string,
  filename: string,
  showToasts: boolean = true
): Promise<void> => {
  let loadingToast: string | undefined;
  
  try {
    const sanitizedFilename = filename || `Drill_${parameters.diameter}mm_${parameters.length}mm`;
    
    if (showToasts) {
      loadingToast = toast.loading(`Generating ${format.toUpperCase()} file...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`Starting export for format: ${format}`);
    
    switch (format.toLowerCase()) {
      case 'stl':
        console.log('Exporting STL format...');
        await exportDrillToSTL(parameters, sanitizedFilename);
        break;
        
      case 'dxf':
        console.log('Exporting DXF format...');
        await exportDrillToDXF(parameters, sanitizedFilename);
        break;
      
      case 'step':
        console.log('Exporting STEP format...');
        await exportDrillToSTEP(parameters, sanitizedFilename);
        break;
              
      default:
        console.log(`Format ${format} not directly supported, falling back to template...`);
        await exportGenericFormat(format, parameters, sanitizedFilename);
        break;
    }
    
    if (showToasts) {
      toast.success(`Exported ${sanitizedFilename}.${format.toLowerCase()} successfully`);
    }
  } catch (error) {
    console.error(`Error exporting ${format}:`, error);
    if (showToasts) {
      toast.error(`Failed to export ${format.toUpperCase()}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } finally {
    if (loadingToast && showToasts) {
      toast.dismiss(loadingToast);
    }
  }
};

async function exportGenericFormat(format: string, parameters: DrillParameters, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      let content = '';
      let mimeType = 'text/plain';
      
      if (format === 'json') {
        content = JSON.stringify(parameters, null, 2);
        mimeType = 'application/json';
      } else if (format === 'csv') {
        const headers = Object.keys(parameters).join(',');
        const values = Object.values(parameters).join(',');
        content = `${headers}\n${values}`;
        mimeType = 'text/csv';
      } else if (format === 'pdf') {
        const content = `PDF DOCUMENT TEMPLATE
        
Drill Specifications
-------------------
Diameter: ${parameters.diameter} mm
Length: ${parameters.length} mm
Shank Diameter: ${parameters.shankDiameter} mm
Shank Length: ${parameters.shankLength} mm
Flute Count: ${parameters.fluteCount}
Flute Length: ${parameters.fluteLength} mm
Tip Angle: ${parameters.tipAngle}°
Helix Angle: ${parameters.helixAngle}°
Material: ${parameters.material.toUpperCase()}
Tolerance: ${parameters.tolerance}
Surface Finish: ${parameters.surfaceFinish}

Note: This is a template - in production, a real PDF with technical drawings would be generated.`;
        mimeType = 'application/pdf';
      }
      
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.${format}`;
      document.body.appendChild(link);
      
      setTimeout(() => {
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          resolve();
        }, 100);
      }, 100);
      
    } catch (error) {
      console.error(`Error exporting ${format}:`, error);
      reject(error);
    }
  });
}
