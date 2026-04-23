import fs from "node:fs/promises";
import path from "node:path";
import { RegisteredModel } from "../types/models.js";

export class ModelRegistry {
  constructor(private readonly filePath: string) {}

  async list(): Promise<RegisteredModel[]> {
    return this.read();
  }

  async upsert(model: RegisteredModel): Promise<void> {
    const models = await this.read();
    const idx = models.findIndex((m) => m.id === model.id);
    if (idx >= 0) {
      models[idx] = model;
    } else {
      models.push(model);
    }
    await this.write(models);
  }

  async remove(id: string): Promise<void> {
    const models = (await this.read()).filter((m) => m.id !== id);
    await this.write(models);
  }

  private async read(): Promise<RegisteredModel[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as RegisteredModel[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      const e = error as { code?: string };
      if (e.code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(models: RegisteredModel[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(models, null, 2), "utf-8");
  }
}
