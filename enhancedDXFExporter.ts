import * as THREE from 'three';
import { DrillParameters } from '@/types/drill';
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { EdgeProjection } from 'three-edge-projection';
import { BVHMesh } from '@/types/bvh';

// Patch THREE to enable BVH support
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

function getVisibleEdges(mesh: BVHMesh, camera: THREE.Camera): THREE.Line3[] {
  mesh.geometry.computeBoundsTree();
  
  const edgeProj = new EdgeProjection(camera, mesh);
  edgeProj.update();
  
  return edgeProj.getEdges();
}

export function enhancedThreeJsToDXF(
  parameters: DrillParameters,
  filename: string
): void {
  const drillModel = createDrillModel(parameters);
  
  // Create multiple cameras for different views
  const cameras = [
    new THREE.PerspectiveCamera(75, 1, 0.1, 1000), // Front view
    new THREE.PerspectiveCamera(75, 1, 0.1, 1000), // Side view
    new THREE.PerspectiveCamera(75, 1, 0.1, 1000)  // Top view
  ];
  
  // Position cameras
  cameras[0].position.set(0, 0, 100); // Front
  cameras[1].position.set(100, 0, 0); // Side
  cameras[2].position.set(0, 100, 0); // Top
  
  cameras.forEach(cam => cam.lookAt(0, 0, 0));

  const visibleEdges: THREE.Line3[] = [];
  
  // Get edges from each view
  cameras.forEach((camera, index) => {
    drillModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const edges = getVisibleEdges(child as BVHMesh, camera);
        // Transform edges based on view
        edges.forEach(edge => {
          const start = edge.start.clone();
          const end = edge.end.clone();
          
          // Apply view-specific transformations
          switch(index) {
            case 0: // Front view
              start.z = 0;
              end.z = 0;
              break;
            case 1: // Side view
              start.x = 0;
              end.x = 0;
              break;
            case 2: // Top view
              start.y = 0;
              end.y = 0;
              break;
          }
          
          visibleEdges.push(new THREE.Line3(start, end));
        });
      }
    });
  });

  const dxfContent = generateDXFFromEdges(visibleEdges, parameters);
  const blob = new Blob([dxfContent], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.dxf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function generateDXFFromEdges(edges: THREE.Line3[], parameters: DrillParameters): string {
  const {
    diameter,
    length,
    shankDiameter,
    shankLength,
    tipAngle,
    fluteLength,
    nonCuttingLength
  } = parameters;

  // Calculate starting position
  const startY = 100;
  const startX = 200;
  const viewSpacing = Math.max(diameter, length) * 1.5;

  // Generate DXF content
  let dxf = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1027
0
ENDSEC
0
SECTION
2
ENTITIES`;

  // Add visible edges for each view
  edges.forEach(edge => {
    const start = edge.start;
    const end = edge.end;
    
    // Determine which view this edge belongs to
    const isTopView = Math.abs(start.y) < 0.001 && Math.abs(end.y) < 0.001;
    const isSideView = Math.abs(start.x) < 0.001 && Math.abs(end.x) < 0.001;
    
    let offsetX = startX;
    let offsetY = startY;
    
    if (isTopView) {
      offsetY += viewSpacing * 2;
    } else if (isSideView) {
      offsetX += viewSpacing;
    }
    
    dxf += `
0
LINE
8
0
10
${offsetX + start.x}
20
${offsetY + start.y}
30
${start.z}
11
${offsetX + end.x}
21
${offsetY + end.y}
31
${end.z}`;
  });

  // Add text annotations for each view
  const views = [
    { name: 'FRONT VIEW', offsetX: startX, offsetY: startY },
    { name: 'SIDE VIEW', offsetX: startX + viewSpacing, offsetY: startY },
    { name: 'TOP VIEW', offsetX: startX, offsetY: startY + viewSpacing * 2 }
  ];

  views.forEach(view => {
    dxf += `
0
TEXT
8
0
10
${view.offsetX - diameter - 20}
20
${view.offsetY - 10}
30
0
40
3
1
${view.name}`;
  });

  // Add dimensions
  dxf += `
0
TEXT
8
0
10
${startX - diameter - 20}
20
${startY - 25}
30
0
40
3
1
Length: ${length} mm
0
TEXT
8
0
10
${startX - diameter - 20}
20
${startY - 30}
30
0
40
3
1
Shank: Ø${shankDiameter} mm
0
TEXT
8
0
10
${startX - diameter - 20}
20
${startY - 35}
30
0
40
3
1
Diameter: Ø${diameter} mm`;

  // Close the DXF file
  dxf += `
0
ENDSEC
0
EOF`;

  return dxf;
}

export function createDrillModel(parameters: DrillParameters): THREE.Object3D {
  const { 
    diameter, 
    length, 
    shankDiameter, 
    shankLength,
    tipAngle,
    fluteCount,
    helixAngle
  } = parameters;
  
  const group = new THREE.Group();
  
  // Create shank cylinder with reduced segments
  const shankGeometry = new THREE.CylinderGeometry(
    shankDiameter / 2,
    shankDiameter / 2,
    shankLength,
    16
  );
  const shankMesh = new THREE.Mesh(shankGeometry);
  shankMesh.position.y = -length / 2 + shankLength / 2;
  
  // Create fluted part
  const fluteLength = length - shankLength - (diameter / 2) * Math.tan((tipAngle * Math.PI) / 360);
  const fluteGeometry = new THREE.CylinderGeometry(
    diameter / 2,
    diameter / 2,
    fluteLength,
    16
  );
  const fluteMesh = new THREE.Mesh(fluteGeometry);
  fluteMesh.position.y = -length / 2 + shankLength + fluteLength / 2;
  
  // Create tip cone
  const tipHeight = (diameter / 2) * Math.tan((tipAngle * Math.PI) / 360);
  const tipGeometry = new THREE.ConeGeometry(
    diameter / 2,
    tipHeight * 2,
    16
  );
  const tipMesh = new THREE.Mesh(tipGeometry);
  tipMesh.position.y = length / 2 - tipHeight;
  tipMesh.rotation.x = Math.PI;

  // Enable BVH for all geometries
  [shankMesh, fluteMesh, tipMesh].forEach(mesh => {
    mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
  });

  // Add meshes to group
  group.add(shankMesh);
  group.add(fluteMesh);
  group.add(tipMesh);
  
  // Orient the drill along Y axis
  group.rotation.x = Math.PI / 2;
  
  return group;
} 