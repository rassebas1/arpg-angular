export enum TileType {
  EMPTY = 0,
  FLOOR = 1,
  WALL = 2,
  DOOR = 3
}

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export class DungeonGenerator {
  width: number;
  height: number;
  grid: TileType[][];
  rooms: Room[] = [];

  constructor(width: number = 50, height: number = 50) {
    this.width = width;
    this.height = height;
    this.grid = Array(height).fill(0).map(() => Array(width).fill(TileType.EMPTY));
  }

  generate(numRooms: number = 10, minSize: number = 5, maxSize: number = 10) {
    this.rooms = [];
    this.grid = Array(this.height).fill(0).map(() => Array(this.width).fill(TileType.EMPTY));

    for (let i = 0; i < numRooms; i++) {
      const width = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
      const height = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
      const x = Math.floor(Math.random() * (this.width - width - 2)) + 1;
      const y = Math.floor(Math.random() * (this.height - height - 2)) + 1;

      const newRoom: Room = {
        x, y, width, height,
        centerX: Math.floor(x + width / 2),
        centerY: Math.floor(y + height / 2)
      };

      if (!this.doesCollide(newRoom)) {
        this.carveRoom(newRoom);
        this.rooms.push(newRoom);
      }
    }

    // Connect rooms
    for (let i = 1; i < this.rooms.length; i++) {
      this.carveCorridor(this.rooms[i - 1], this.rooms[i]);
    }

    // Add walls around floors
    this.addWalls();

    return {
      grid: this.grid,
      rooms: this.rooms
    };
  }

  private doesCollide(room: Room): boolean {
    for (const r of this.rooms) {
      if (room.x <= r.x + r.width + 1 && room.x + room.width + 1 >= r.x &&
          room.y <= r.y + r.height + 1 && room.y + room.height + 1 >= r.y) {
        return true;
      }
    }
    return false;
  }

  private carveRoom(room: Room) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        this.grid[y][x] = TileType.FLOOR;
      }
    }
  }

  private carveCorridor(roomA: Room, roomB: Room) {
    let x = roomA.centerX;
    let y = roomA.centerY;

    while (x !== roomB.centerX) {
      this.grid[y][x] = TileType.FLOOR;
      this.grid[y+1][x] = TileType.FLOOR; // 2-tile wide corridors
      x += x < roomB.centerX ? 1 : -1;
    }
    while (y !== roomB.centerY) {
      this.grid[y][x] = TileType.FLOOR;
      this.grid[y][x+1] = TileType.FLOOR; // 2-tile wide corridors
      y += y < roomB.centerY ? 1 : -1;
    }
  }

  private addWalls() {
    const newGrid = this.grid.map(row => [...row]);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x] === TileType.FLOOR) {
          // Check 8 neighbors
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = y + dy;
              const nx = x + dx;
              if (ny >= 0 && ny < this.height && nx >= 0 && nx < this.width) {
                if (this.grid[ny][nx] === TileType.EMPTY) {
                  newGrid[ny][nx] = TileType.WALL;
                }
              }
            }
          }
        }
      }
    }
    this.grid = newGrid;
  }
}
