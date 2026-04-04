import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata'

export type ColumnUnion = ColumnMetadata | RelationMetadata

export type JoinFunction = (relation: string, alias: string) => void
export type SelectFunction = (columns: string[]) => void
