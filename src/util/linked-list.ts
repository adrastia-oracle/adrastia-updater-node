import { List } from "./list";

export class ListNode<T> {
    constructor(
        public value: T,
        public next: ListNode<T> | null = null,
        public prev: ListNode<T> | null = null,
    ) {}
}

/**
 * Class representing a doubly linked list.
 * Each node in the list contains a value and references to both the next and previous nodes,
 * allowing bidirectional traversal.
 */
export class LinkedList<T> implements List<T> {
    private head: ListNode<T> | null = null;
    private tail: ListNode<T> | null = null; // New tail reference
    private length: number = 0;

    /**
     * Returns the number of elements in the linked list.
     * @returns {number} The current size of the linked list.
     */
    public size(): number {
        return this.length;
    }

    /**
     * Checks if the linked list is empty.
     * @returns {boolean} True if the linked list is empty, false otherwise.
     */
    public isEmpty(): boolean {
        return this.size() === 0;
    }

    /**
     * Adds a new element to the linked list at the specified index.
     * If the index is equal to the length of the list, the element is added at the end.
     * @param {T} value - The value to be added.
     * @param {number} [index=this.length] - The index at which to add the new element.
     * @throws Will throw an error if the index is out of bounds.
     */
    public add(value: T, index: number = this.length): void {
        if (index < 0 || index > this.length) {
            throw new Error("Index out of bounds");
        }

        const newNode = new ListNode(value);
        if (index === 0) {
            if (this.head) {
                this.head.prev = newNode;
            }
            newNode.next = this.head;
            this.head = newNode;
            if (!this.tail) {
                this.tail = newNode; // First element is both head and tail
            }
        } else if (index === this.length) {
            if (this.tail) {
                this.tail.next = newNode;
            }
            newNode.prev = this.tail;
            this.tail = newNode;
            if (!this.head) {
                this.head = newNode; // First element is both head and tail
            }
        } else {
            let current = this.head;
            for (let i = 0; i < index; i++) {
                current = current!.next;
            }
            newNode.next = current;
            newNode.prev = current!.prev;
            current!.prev!.next = newNode;
            current!.prev = newNode;
        }
        this.length++;
    }

    /**
     * Adds a new element at the beginning of the linked list.
     * @param {T} value - The value to be added.
     */
    public addFirst(value: T): void {
        this.add(value, 0);
    }

    /**
     * Adds all elements from the specified iterable to the linked list.
     * @param {Iterable<T>} values - The values to be added.
     */
    public addAll(values: Iterable<T>): void {
        for (const value of values) {
            this.add(value);
        }
    }

    /**
     * Removes and returns the first element from the linked list.
     * @returns {T | null} The value of the removed element, or null if the list is empty.
     * @throws Will throw an error if there are no elements to remove.
     */
    public removeFirst(): T | null {
        if (!this.head) {
            throw new Error("No elements to remove");
        }

        const value = this.head.value;
        this.head = this.head.next;
        if (this.head) {
            this.head.prev = null;
        } else {
            this.tail = null; // List is now empty
        }
        this.length--;
        return value;
    }

    /**
     * Removes and returns the last element from the linked list.
     * @returns {T | null} The value of the removed element, or null if the list is empty.
     * @throws Will throw an error if there are no elements to remove.
     */
    public removeLast(): T | null {
        if (!this.tail) {
            throw new Error("No elements to remove");
        }

        const value = this.tail.value;
        this.tail = this.tail.prev;
        if (this.tail) {
            this.tail.next = null;
        } else {
            this.head = null; // List is now empty
        }
        this.length--;
        return value;
    }

    /**
     * Retrieves the element at the specified index.
     * @param {number} index - The index of the element to retrieve.
     * @returns {T} The value of the element at the specified index.
     * @throws Will throw an error if the index is out of bounds.
     */
    public get(index: number): T {
        if (index < 0 || index >= this.length) {
            throw new Error("Index out of bounds");
        }

        let current: ListNode<T>;
        if (index < this.length / 2) {
            current = this.head!;
            for (let i = 0; i < index; i++) {
                current = current.next!;
            }
        } else {
            current = this.tail!;
            for (let i = this.length - 1; i > index; i--) {
                current = current.prev!;
            }
        }
        return current.value;
    }

    /**
     * Removes and returns the element at the specified index.
     * @param {number} index - The index of the element to remove.
     * @returns {T} The value of the removed element.
     * @throws Will throw an error if the index is out of bounds.
     */
    public remove(index: number): T {
        if (index < 0 || index >= this.length) {
            throw new Error("Index out of bounds");
        }

        let removedNode: ListNode<T>;
        if (index === 0) {
            removedNode = this.head!;
            this.head = this.head!.next;
            if (this.head) {
                this.head.prev = null;
            } else {
                this.tail = null; // List is now empty
            }
        } else if (index === this.length - 1) {
            removedNode = this.tail!;
            this.tail = this.tail!.prev;
            if (this.tail) {
                this.tail.next = null;
            } else {
                this.head = null; // List is now empty
            }
        } else {
            removedNode = this.head!;
            for (let i = 0; i < index; i++) {
                removedNode = removedNode.next!;
            }
            removedNode.prev!.next = removedNode.next;
            removedNode.next!.prev = removedNode.prev;
        }

        this.length--;
        return removedNode.value;
    }

    /**
     * Creates and returns a deep copy of the linked list.
     * @returns {LinkedList<T>} A new LinkedList instance containing the same elements.
     */
    public clone(): LinkedList<T> {
        const newList = new LinkedList<T>();
        let current = this.head;
        while (current) {
            newList.add(current.value);
            current = current.next;
        }
        return newList;
    }

    /**
     * Makes the LinkedList class iterable, allowing the use of for...of loops.
     * @returns An iterator over the elements of the list.
     */
    [Symbol.iterator](): Iterator<T> {
        let current = this.head;

        return {
            next(): IteratorResult<T> {
                if (current) {
                    const value = current.value;
                    current = current.next;
                    return { value, done: false };
                } else {
                    return { value: null, done: true };
                }
            },
        };
    }
}
