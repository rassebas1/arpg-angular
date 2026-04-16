import { Injectable, signal } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

@Injectable({
  providedIn: 'root'
})
export class AssetService {
  private modelLoader?: GLTFLoader;
  private textureLoader?: THREE.TextureLoader;
  
  private models = new Map<string, GLTF>();
  private textures = new Map<string, THREE.Texture>();
  
  public loadingProgress = signal(0);
  public isLoaded = signal(false);

  async loadAssets(manifest: { models: Record<string, string>, textures: Record<string, string> }) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.isLoaded.set(true);
      return;
    }

    if (!this.modelLoader) this.modelLoader = new GLTFLoader();
    if (!this.textureLoader) this.textureLoader = new THREE.TextureLoader();

    const modelKeys = Object.keys(manifest.models);
    const textureKeys = Object.keys(manifest.textures);
    const total = modelKeys.length + textureKeys.length;
    
    if (total === 0) {
      this.isLoaded.set(true);
      return;
    }
    
    let loaded = 0;

    const updateProgress = () => {
      loaded++;
      this.loadingProgress.set(Math.floor((loaded / total) * 100));
    };

    const modelPromises = modelKeys.map(async key => {
      try {
        const gltf = await this.modelLoader!.loadAsync(manifest.models[key]);
        this.models.set(key, gltf);
      } catch (e) {
        console.warn(`Failed to load model: ${key}`, e);
      }
      updateProgress();
    });

    const texturePromises = textureKeys.map(async key => {
      try {
        const texture = await this.textureLoader!.loadAsync(manifest.textures[key]);
        this.textures.set(key, texture);
      } catch (e) {
        console.warn(`Failed to load texture: ${key}`, e);
      }
      updateProgress();
    });

    await Promise.all([...modelPromises, ...texturePromises]);
    this.isLoaded.set(true);
  }

  getModel(key: string): GLTF | undefined {
    return this.models.get(key);
  }

  getTexture(key: string): THREE.Texture | undefined {
    return this.textures.get(key);
  }

  cloneModel(key: string): THREE.Group | undefined {
    const gltf = this.models.get(key);
    if (!gltf) return undefined;
    
    // Use SkeletonUtils to properly clone skinned meshes and their bones
    const clone = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    
    // Ensure shadows are preserved on clones
    clone.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }
}
