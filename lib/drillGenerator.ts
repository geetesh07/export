import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { DrillParameters } from '@/types/drill';

/**
 * This generates a drill bit with helical flutes using optimized CSG.
 */
export const generateDrillGeometry = (parameters: DrillParameters): THREE.BufferGeometry => {
  const { 
    diameter, 
    shankDiameter, 
    shankLength,
    fluteCount, 
    fluteLength, 
    nonCuttingLength = 0,
    tipAngle, 
    helixAngle,
    material
  } = parameters;
  
  // Basic validation and safety checks
  const MIN_DIAMETER = 0.1;
  const MAX_SHANK_DIAMETER = 32;
  const MIN_SEGMENTS = 32;   // Increased for better quality
  const MAX_SEGMENTS = 64;   // Increased for better quality
  
  // Smart segment calculation based on diameter
  const calculateSegments = (d: number, isFlute: boolean = false) => {
    // For flutes, use more segments for smoother appearance
    const baseMultiplier = isFlute ? 24 : 18;  // Increased multipliers for better quality
    const segments = Math.max(
      MIN_SEGMENTS,
      Math.min(MAX_SEGMENTS, Math.floor(d * baseMultiplier))
    );
    return segments;
  };
  
  // Ensure diameters are within valid ranges
  const effectiveDiameter = Math.max(diameter, MIN_DIAMETER);
  const effectiveShankDiameter = Math.min(Math.max(shankDiameter, MIN_DIAMETER), MAX_SHANK_DIAMETER);
  
  // Calculate basic parameters
  const tipHeight = tipAngle === 180 ? 0 : (effectiveDiameter / 2) / Math.tan((tipAngle / 2) * Math.PI / 180);
  const extensionLength = effectiveDiameter * 1.1; // Length of straight line curve
  const flutedPartLength = fluteLength - tipHeight - extensionLength; // Include extension length in fluted part
  const chamferHeight = Math.abs(effectiveDiameter - effectiveShankDiameter) / 2;
  
  // Calculate total length
  const totalLength = shankLength + chamferHeight + nonCuttingLength + flutedPartLength + tipHeight;
  
  // Create the main geometries
  const geometries: THREE.BufferGeometry[] = [];
  let currentPosition = -totalLength / 2;
  
  try {
    // 1. Create shank with calculated segments
    const shankSegments = calculateSegments(effectiveShankDiameter);
    const shank = new THREE.CylinderGeometry(
      effectiveShankDiameter / 2,
      effectiveShankDiameter / 2,
      shankLength,
      shankSegments,
      1,
      false
    );
    shank.translate(0, currentPosition + shankLength / 2, 0);
    geometries.push(shank);
    currentPosition += shankLength;
    
    // 2. Create chamfer if needed with calculated segments
    if (chamferHeight > 0) {
      // Create a single chamfer with 45-degree angle
      const chamferSegments = Math.max(32, Math.min(64, Math.floor(effectiveDiameter * 8)));
      const chamfer = new THREE.CylinderGeometry(
        effectiveDiameter / 2,
        effectiveShankDiameter / 2,
        chamferHeight,
        chamferSegments,
        1,
        false
      );
      chamfer.translate(0, currentPosition + chamferHeight / 2, 0);
      geometries.push(chamfer);
      currentPosition += chamferHeight;
    }
    
    // 3. Create non-cutting length with calculated segments
    if (nonCuttingLength > 0) {
      const nonCuttingSegments = calculateSegments(effectiveDiameter);
      const nonCuttingPart = new THREE.CylinderGeometry(
        effectiveDiameter / 2,
        effectiveDiameter / 2,
        nonCuttingLength,
        nonCuttingSegments,
        1,
        false
      );
      nonCuttingPart.translate(0, currentPosition + nonCuttingLength / 2, 0);
      geometries.push(nonCuttingPart);
      currentPosition += nonCuttingLength;
    }
    
    // Store flute start position
    const fluteStartPosition = currentPosition;
    
    // 4. Create fluted part with calculated segments
    const flutedSegments = calculateSegments(effectiveDiameter);
    const flutedPart = new THREE.CylinderGeometry(
      effectiveDiameter / 2,
      effectiveDiameter / 2,
      flutedPartLength,
      flutedSegments,
      1,
      false
    );
    flutedPart.translate(0, currentPosition + flutedPartLength / 2, 0);
    geometries.push(flutedPart);
    currentPosition += flutedPartLength;
    
    // 5. Create tip with calculated segments
    if (tipAngle !== 180) {
      const tipSegments = calculateSegments(effectiveDiameter);
      const tip = new THREE.ConeGeometry(
        effectiveDiameter / 2,
        tipHeight,
        tipSegments,
        1,
        false
      );
      tip.translate(0, currentPosition + tipHeight / 2, 0);
      geometries.push(tip);
    } else {
      const endCapSegments = calculateSegments(effectiveDiameter);
      const endCap = new THREE.CircleGeometry(
        effectiveDiameter / 2,
        endCapSegments
      );
      endCap.rotateX(Math.PI / 2);
      endCap.translate(0, currentPosition, 0);
      geometries.push(endCap);
    }
    
    // Merge basic geometries
    let drillBody = mergeBufferGeometries(geometries);
    const drillBodyMaterial = new THREE.MeshStandardMaterial();
    let drillBodyMesh = new THREE.Mesh(drillBody, drillBodyMaterial);
    
    // Create flutes if needed
    if (fluteCount > 0) {
      // Convert helix angle to radians
      const helixAngleRad = (helixAngle * Math.PI) / 180;
      
      // Calculate flute depth
      const diameterRatio = effectiveDiameter / effectiveShankDiameter;
      const baseFluteDepth = effectiveDiameter * 0.25;
      
      // Scale flute depth based on diameter ratio with a more gradual transition
      const fluteDepthScale = diameterRatio > 1.5 ? 
        Math.max(0.3, 1.0 / Math.sqrt(diameterRatio)) : 1.0;
      const fluteDepth = baseFluteDepth * fluteDepthScale;
      
      // Calculate helix pitch
      const helixPitch = Math.PI * effectiveDiameter / Math.tan(helixAngleRad);
      
      const radius = effectiveDiameter / 2;
      const fluteGeometries: THREE.BufferGeometry[] = [];
      
      for (let flute = 0; flute < fluteCount; flute++) {
        const baseAngle = (2 * Math.PI * flute) / fluteCount;
        
        try {
          // Standard helix height calculation
          const calculatedRevolutions = flutedPartLength / helixPitch;
          const revolutions = Math.max(1.2, calculatedRevolutions);
          const helixHeight = flutedPartLength;
          
          // Use the full extension length
          const extensionStartPosition = fluteStartPosition + extensionLength;
          
          const unifiedCurve = new UnifiedHelixAndExtensionCurve(
            radius,
            helixHeight,
            helixPitch,
            baseAngle,
            extensionStartPosition,
            extensionLength
          );
          
          // Use more segments for better quality
          const tubularSegments = Math.max(64, Math.ceil(revolutions * 24));  // Increased for better quality
          const radialSegments = Math.max(32, Math.ceil(diameter * 4));  // Increased for better quality
          
          const tubeGeometry = new THREE.TubeGeometry(
            unifiedCurve,
            tubularSegments,
            fluteDepth,
            radialSegments,
            false
          );
          
          fluteGeometries.push(tubeGeometry);
        } catch (error) {
          console.error('Error creating flute geometry:', error);
        }
      }
      
      if (fluteGeometries.length > 0) {
        const mergedFluteGeometry = mergeBufferGeometries(fluteGeometries);
        const fluteMaterial = new THREE.MeshStandardMaterial();
        const fluteMesh = new THREE.Mesh(mergedFluteGeometry, fluteMaterial);
        
        try {
          // Improve CSG operation handling
          const indexedDrill = drillBodyMesh.geometry.toNonIndexed();
          const indexedFlute = fluteMesh.geometry.toNonIndexed();
          
          // Add error checking for geometry validity
          if (!indexedDrill.getAttribute('position') || !indexedFlute.getAttribute('position')) {
            console.error('Invalid geometry for CSG operation');
            return drillBodyMesh.geometry;
          }
          
          const csgDrill = CSG.fromMesh(new THREE.Mesh(indexedDrill, drillBodyMaterial));
          const csgFlute = CSG.fromMesh(new THREE.Mesh(indexedFlute, fluteMaterial));
          
          const csgResult = csgDrill.subtract(csgFlute);
          const resultMesh = CSG.toMesh(csgResult, new THREE.Matrix4());
          
          if (!resultMesh.geometry.getAttribute('position')) {
            console.error('CSG operation produced invalid geometry');
            return drillBodyMesh.geometry;
          }
          
          drillBodyMesh = new THREE.Mesh(resultMesh.geometry, drillBodyMaterial);
          drillBody = healGeometry(drillBodyMesh.geometry);
          drillBodyMesh = new THREE.Mesh(drillBody, drillBodyMaterial);
        } catch (error) {
          console.error('Error in CSG operation:', error);
        }
      }
    }
    
    return drillBodyMesh.geometry;
  } catch (error) {
    console.error('Error generating drill geometry:', error);
    // Return a simple cylinder as fallback
    return new THREE.CylinderGeometry(
      effectiveDiameter / 2,
      effectiveDiameter / 2,
      totalLength,
      MIN_SEGMENTS,
      1,
      false
    );
  }
};

/**
 * A custom curve class that represents a continuous curve with both
 * a helical part and a straight extension part
 */
class UnifiedHelixAndExtensionCurve extends THREE.Curve<THREE.Vector3> {
  private totalLength: number;
  private helixTotalRevolutions: number;
  
  constructor(
    private radius: number,
    private helixHeight: number,
    private helixPitch: number,
    private baseAngle: number,
    private startY: number,
    private extensionLength: number
  ) {
    super();
    
    // Calculate total helix revolutions
    this.helixTotalRevolutions = this.helixHeight / this.helixPitch;
    
    // Calculate approximate total curve length
    // For a helix, each revolution has length ~= 2πr + pitch²/2πr
    const helixLength = this.helixTotalRevolutions * 
      (2 * Math.PI * this.radius + Math.pow(this.helixPitch, 2) / (2 * Math.PI * this.radius));
      
    this.totalLength = helixLength + extensionLength;
  }
  
  getPoint(t: number, optionalTarget?: THREE.Vector3): THREE.Vector3 {
    const target = optionalTarget || new THREE.Vector3();
    
    // Separate the curve into extension part and helix part
    // t = 0 is at the end of the extension (farthest from helix)
    // t = t_split is at the junction between extension and helix
    // t = 1 is at the end of the helix
    
    // Calculate what portion of the total curve is the extension
    const extensionRatio = this.extensionLength / this.totalLength;
    
    // If t is in the extension part
    if (t <= extensionRatio) {
      // Normalize t for the extension part (0 to 1)
      const extensionT = t / extensionRatio;
      
      // Calculate the tangent direction at the start of the helix
      // For a helix with parametric equation (r*cos(t), h*t/(2π), r*sin(t)),
      // the tangent is proportional to (-r*sin(t), h/(2π), r*cos(t))
      const pitchFactor = this.helixPitch / (2 * Math.PI);
      const tangentX = -this.radius * Math.sin(this.baseAngle);
      const tangentY = pitchFactor;
      const tangentZ = this.radius * Math.cos(this.baseAngle);
      
      // Normalize the tangent vector
      const tangentLength = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);
      const normalizedTangentX = tangentX / tangentLength;
      const normalizedTangentY = tangentY / tangentLength;
      const normalizedTangentZ = tangentZ / tangentLength;
      
      // Calculate the helix starting point
      const helixStartPoint = new THREE.Vector3(
        this.radius * Math.cos(this.baseAngle),
        this.startY,
        this.radius * Math.sin(this.baseAngle)
      );
      
      // Calculate the extension end point (opposite Y direction from helix tangent)
      const extensionEndPoint = new THREE.Vector3(
        helixStartPoint.x + normalizedTangentX * this.extensionLength,
        helixStartPoint.y - normalizedTangentY * this.extensionLength, // Opposite Y
        helixStartPoint.z + normalizedTangentZ * this.extensionLength
      );
      
      // Linear interpolate from extension end to helix start
      // Note: extensionT=0 is at extension end, extensionT=1 is at helix start
      target.lerpVectors(extensionEndPoint, helixStartPoint, extensionT);
      return target;
    }
    // If t is in the helix part
    else {
      // Normalize t for the helix part (0 to 1)
      const helixT = (t - extensionRatio) / (1 - extensionRatio);
      
      // Calculate the parametric position on the helix
      // Ensure we complete the exact number of revolutions regardless of pitch
      const angle = this.baseAngle - helixT * (this.helixTotalRevolutions * 2 * Math.PI);
      const y = this.startY + helixT * this.helixHeight;
      const x = this.radius * Math.cos(angle);
      const z = this.radius * Math.sin(angle);
      
      target.set(x, y, z);
      return target;
    }
  }
}

// Helper function to heal geometry after CSG operations
function healGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // Make a copy to avoid modifying the original
  const healed = geometry.clone();
  
  // Ensure we have position attribute
  if (!healed.getAttribute('position')) {
    console.error('Geometry missing position attribute');
    return healed;
  }
  
  // Recompute vertex normals for better lighting
  healed.computeVertexNormals();
  
  // Ensure we have UV coordinates
  if (!healed.getAttribute('uv')) {
    const uvs = [];
    const vertexCount = healed.getAttribute('position').count;
    
    for (let i = 0; i < vertexCount; i++) {
      uvs.push(0, 0); // Default UV coordinates
    }
    
    healed.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  
  // Ensure bounding volumes are up to date
  healed.computeBoundingSphere();
  healed.computeBoundingBox();
  
  return healed;
}

// Helper function to merge buffer geometries
function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Get total number of vertices
  let vertexCount = 0;
  let indexCount = 0;
  
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    vertexCount += position.count;
    
    if (geometry.index) {
      indexCount += geometry.index.count;
    }
  }
  
  // Create merged geometry
  const mergedGeometry = new THREE.BufferGeometry();
  
  // Create arrays for attributes
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  
  // Create index array if needed
  let indices: Uint32Array | null = null;
  if (indexCount > 0) {
    indices = new Uint32Array(indexCount);
  }
  
  // Merge geometries
  let vertexOffset = 0;
  let indexOffset = 0;
  
  for (const geometry of geometries) {
    // Copy position attribute
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      positions[vertexOffset * 3 + i * 3] = position.getX(i);
      positions[vertexOffset * 3 + i * 3 + 1] = position.getY(i);
      positions[vertexOffset * 3 + i * 3 + 2] = position.getZ(i);
    }
    
    // Copy normal attribute if it exists
    const normal = geometry.getAttribute('normal');
    if (normal) {
      for (let i = 0; i < normal.count; i++) {
        normals[vertexOffset * 3 + i * 3] = normal.getX(i);
        normals[vertexOffset * 3 + i * 3 + 1] = normal.getY(i);
        normals[vertexOffset * 3 + i * 3 + 2] = normal.getZ(i);
      }
    }
    
    // Copy uv attribute if it exists
    const uv = geometry.getAttribute('uv');
    if (uv) {
      for (let i = 0; i < uv.count; i++) {
        uvs[vertexOffset * 2 + i * 2] = uv.getX(i);
        uvs[vertexOffset * 2 + i * 2 + 1] = uv.getY(i);
      }
    }
    
    // Copy indices if they exist
    if (geometry.index && indices) {
      for (let i = 0; i < geometry.index.count; i++) {
        indices[indexOffset + i] = geometry.index.getX(i) + vertexOffset;
      }
      indexOffset += geometry.index.count;
    }
    
    vertexOffset += position.count;
  }
  
  // Set attributes on merged geometry
  mergedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  mergedGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  
  if (indices) {
  mergedGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  
  return mergedGeometry;
}
