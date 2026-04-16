import * as THREE from 'three';
import { TileType } from './dungeon-generator';

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

export class Pathfinding {
  private grid: TileType[][];
  private width: number;
  private height: number;

  constructor(grid: TileType[][]) {
    this.grid = grid;
    this.height = grid.length;
    this.width = grid[0].length;
  }

  public findPath(startX: number, startY: number, targetX: number, targetY: number): {x: number, y: number}[] {
    if (!this.isValid(startX, startY) || !this.isValid(targetX, targetY)) {
      return [];
    }

    const openList: Node[] = [];
    const closedList: boolean[][] = Array(this.height).fill(false).map(() => Array(this.width).fill(false));

    const startNode: Node = { x: startX, y: startY, g: 0, h: 0, f: 0, parent: null };
    openList.push(startNode);

    const maxIterations = 1000;
    let iterations = 0;

    while (openList.length > 0 && iterations < maxIterations) {
      iterations++;
      
      // Find node with lowest f score
      let lowestIndex = 0;
      for (let i = 1; i < openList.length; i++) {
        if (openList[i].f < openList[lowestIndex].f) {
          lowestIndex = i;
        }
      }

      const currentNode = openList[lowestIndex];

      // Reached target?
      if (currentNode.x === targetX && currentNode.y === targetY) {
        const path: {x: number, y: number}[] = [];
        let current: Node | null = currentNode;
        while (current !== null) {
          path.push({ x: current.x, y: current.y });
          current = current.parent;
        }
        return path.reverse();
      }

      openList.splice(lowestIndex, 1);
      closedList[currentNode.y][currentNode.x] = true;

      // Check neighbors
      const neighbors = [
        { x: 0, y: -1 }, { x: 0, y: 1 },
        { x: -1, y: 0 }, { x: 1, y: 0 },
        { x: -1, y: -1 }, { x: 1, y: -1 },
        { x: -1, y: 1 }, { x: 1, y: 1 }
      ];

      for (const offset of neighbors) {
        const neighborX = currentNode.x + offset.x;
        const neighborY = currentNode.y + offset.y;

        if (!this.isValid(neighborX, neighborY) || closedList[neighborY][neighborX]) {
          continue;
        }

        // Prevent cutting corners
        if (offset.x !== 0 && offset.y !== 0) {
          if (!this.isValid(currentNode.x + offset.x, currentNode.y) || !this.isValid(currentNode.x, currentNode.y + offset.y)) {
            continue;
          }
        }

        const gScore = currentNode.g + (offset.x === 0 || offset.y === 0 ? 1 : 1.414);
        
        let neighborNode = openList.find(n => n.x === neighborX && n.y === neighborY);
        
        if (!neighborNode) {
          const hScore = this.heuristic(neighborX, neighborY, targetX, targetY);
          neighborNode = {
            x: neighborX,
            y: neighborY,
            g: gScore,
            h: hScore,
            f: gScore + hScore,
            parent: currentNode
          };
          openList.push(neighborNode);
        } else if (gScore < neighborNode.g) {
          neighborNode.g = gScore;
          neighborNode.f = gScore + neighborNode.h;
          neighborNode.parent = currentNode;
        }
      }
    }

    return [];
  }

  private isValid(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.grid[y][x] === TileType.FLOOR || this.grid[y][x] === TileType.DOOR;
  }

  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    // Chebyshev distance
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  }
}
