import * as THREE from 'three';

export enum InteractableType {
  CHEST = 'chest',
  SHRINE_HEALTH = 'shrine_health',
  SHRINE_EXP = 'shrine_exp'
}

export interface Interactable {
  id: string;
  type: InteractableType;
  position: THREE.Vector3;
  isUsed: boolean;
  mesh?: THREE.Object3D;
}

export function createFallbackTexture(type: InteractableType): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = type === InteractableType.CHEST ? '#8B4513' : (type === InteractableType.SHRINE_HEALTH ? '#ff4444' : '#4444ff');
    ctx.fillRect(0, 0, 128, 128);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    let text = '?';
    if (type === InteractableType.CHEST) text = 'CHEST';
    if (type === InteractableType.SHRINE_HEALTH) text = 'HP+';
    if (type === InteractableType.SHRINE_EXP) text = 'EXP+';
    
    ctx.fillText(text, 64, 64);
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
