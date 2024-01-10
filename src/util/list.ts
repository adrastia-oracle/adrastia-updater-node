/**
 * Interface representing a generic List.
 */
export interface List<T> {
    /**
     * Adds an element to the list at the end.
     * @param value The element to add.
     */
    add(value: T): void;

    /**
     * Adds an element to the list at the specified index.
     * @param value The element to add.
     * @param index The position at which to add the element.
     */
    add(value: T, index: number): void;

    /**
     * Adds an element at the beginning of the list.
     * @param value The element to add.
     */
    addFirst(value: T): void;

    /**
     * Adds all elements from the specified iterable to the list.
     * @param values The values to add.
     */
    addAll(values: Iterable<T>): void;

    /**
     * Removes and returns the first element of the list.
     * @returns The removed element.
     */
    removeFirst(): T | null;

    /**
     * Removes and returns the last element of the list.
     * @returns The removed element.
     */
    removeLast(): T | null;

    /**
     * Retrieves the element at the specified index.
     * @param index The index of the element to retrieve.
     * @returns The element at the specified index.
     */
    get(index: number): T;

    /**
     * Removes the element at the specified index.
     * @param index The index of the element to remove.
     * @returns The removed element.
     */
    remove(index: number): T;

    /**
     * Returns the number of elements in the list.
     * @returns The size of the list.
     */
    size(): number;

    /**
     * Checks if the list is empty.
     * @returns `true` if the list is empty, `false` otherwise.
     */
    isEmpty(): boolean;

    /**
     * Creates a deep copy of the list.
     * @returns A new list instance containing the same elements.
     */
    clone(): List<T>;

    /**
     * Creates an iterator over the elements of the list from first to last.
     * @returns An iterator over the elements of the list.
     */
    [Symbol.iterator](): Iterator<T>;
}
